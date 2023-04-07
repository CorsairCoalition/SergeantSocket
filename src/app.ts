/// <reference path="./app.d.ts" />

import io from 'socket.io-client'
import { GameState } from './gameState.js'
import { Log, later, random } from './utils.js'
import { Redis } from './redis.js'
import crypto from 'crypto'

export class App {
	public botId: string
	private gamePhase: Game.Phase = Game.Phase.INITIALIZING
	private gameType: Game.Type
	private gameState: GameState
	private replay_id: string = ""
	private usernames: string[]
	private queueNumPlayers: number = 0
	private forceStartSet: boolean = false
	private customOptionsSet: boolean = false
	private redis: Redis
	private gameConfig: Config.Game
	private initialized: boolean = false
	private socket: any

	constructor(gameConfig: Config.Game, redisConfig: Config.Redis) {
		// create a unique botId by hashing gameConfig.userId
		this.botId = crypto.createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
		redisConfig.CHANNEL_PREFIX = gameConfig.BOT_CLASS + '-' + this.botId + '-'
		this.gameConfig = gameConfig

		this.initializeSocketConnection()
		this.initializeRedisConnection(redisConfig).then(() => {
			this.redis.deconflict()
		})

	}

	private initializeSocketConnection = () => {
		this.socket = io(this.gameConfig.GAME_SERVER_URL, {
			rejectUnauthorized: false,
			transports: ['websocket']
		})
		this.socket.on('connect', this.handleConnect)
		this.socket.on("error", (error: Error) => Log.stderr(`[socket.io] {error}`))
		this.socket.on("connect_error", (error: Error) => Log.stderr(`[socket.io] {error}`))
		this.socket.on('error_set_username', this.handleErrorSetUsername)
		this.socket.on('queue_update', this.handleQueueUpdate)
		this.socket.on('game_start', this.handleGameStart)
		this.socket.on('game_won', this.handleGameWon)
		this.socket.on('game_lost', this.handleGameLost)
		this.socket.on('game_update', this.handleGameUpdate)
		this.socket.on('disconnect', this.handleDisconnect)
	}

	private initializeRedisConnection = async (redisConfig: Config.Redis) => {
		this.redis = new Redis(redisConfig)
		this.redis.subscribeToRecommendations(this.handleRecommendations)
		await this.redis.subscribeToCommands(this.handleCommand).then((gameKeyspace: string) => {
			Log.stdout('[Redis] subscribed: ' + gameKeyspace)
		})
	}

	private handleCommand = (command: RedisData.Command.Any) => {
		// control game: join / leave / options

		if (command.join) {
			this.joinGame(command.join)
			return
		}

		if (command.leave) {
			if (this.gamePhase === Game.Phase.PLAYING || this.gamePhase === Game.Phase.JOINED_LOBBY) {
				this.leaveGame()
			} else {
				Log.stderr(`[leave] not in a game`)
			}
			return
		}

		if (command.options) {
			// if options.customGameSpeed is not defined then do nothing
			if (!command.options.customGameSpeed) return

			this.gameConfig.customGameSpeed = command.options.customGameSpeed
			if (this.gamePhase === Game.Phase.JOINED_LOBBY) {
				this.customOptionsSet = false
				later(100).then(() => {
					this.setCustomOptions(this.gameConfig.customGameSpeed)
				})
			} else {
				Log.stderr(`[options] not in lobby`)
			}
			return
		}

		if (command.forceStart) {
			this.forceStartSet = false
			setTimeout(this.setForceStart, 200)
			return
		}
	}

	private handleRecommendations = (data: RedisData.Recommendation) => {
		// TODO: push action to the game

		if (this.gamePhase !== Game.Phase.PLAYING) {
			Log.stderr(`[recommendation] not in game`)
			return
		}
	}

	private handleConnect = () => {
		Log.stdout(`[connected] ${this.gameConfig.username}`)
		this.redis.sendUpdate({ connected: this.gameConfig.username })
		if (this.gameConfig.setUsername) {
			this.socket.emit('set_username', this.gameConfig.userId, this.gameConfig.username)
			Log.debug(`sent: set_username, ${this.gameConfig.userId}, ${this.gameConfig.username}`)
		}
	}

	private handleDisconnect = (reason: string) => {
		// exit if disconnected intentionally; auto-reconnect otherwise
		this.redis.sendUpdate({ disconnected: reason })
		switch (reason) {
			case 'io server disconnect':
				Log.stderr("disconnected: " + reason)
				process.exit(3)
			case 'io client disconnect':
				process.exit(0)
			default:
				Log.stderr("disconnected: " + reason)
		}
	}

	private handleErrorSetUsername = (message: string) => {
		if (message === '') {
			// success
			Log.stdout(`[set_username] username set to ${this.gameConfig.username}`)
			return
		}
		Log.stdout(`[error_set_username] ${message}`)
	}

	private handleGameStart = (data: GeneralsIO.GameStart) => {
		// Get ready to start playing the game.
		this.replay_id = data.replay_id
		this.initialized = false

		Log.stdout(`[game_start] replay: ${this.replay_id}, users: ${data.usernames}`)
		this.redis.sendUpdate({ game_start: data })

		this.gameState = new GameState(data)

		// iterate over gameConfig.warCry to send chat messages
		// send messages at random intervals to appear more human
		for (let i = 0; i < this.gameConfig.warCry.length; i++) {
			later(random(i * 3000, (i + 1) * 3000)).then(() => {
				this.socket.emit('chat_message', data.chat_room, this.gameConfig.warCry[i])
				Log.debug(`sent: [chat_message] ${this.gameConfig.warCry[i]}`)
			})
		}

		this.gamePhase = Game.Phase.PLAYING
	}

	private handleGameUpdate = (data: GeneralsIO.GameUpdate) => {
		if (data.turn > this.gameConfig.MAX_TURNS) {
			Log.stdout(`[game_update] ${this.replay_id}, turn: ${data.turn}, max turns reached`)
			this.leaveGame()
			return
		}

		// update the local game state
		this.redis.sendUpdate({ game_update: data })
		this.gameState.update(data)
		this.redis.sendUpdate({ game_state: this.gameState })


		// TODO: updateGameData fails due to invalid argument type
		// this.redis.updateGameData(this.gameState)
	}

	private handleGameLost = (data: GeneralsIO.GameLost) => {
		Log.stdout(`[game_lost] ${this.replay_id}, killer: ${this.gameState.usernames[data.killer]}`)
		this.redis.sendUpdate({
			game_lost: {
				replay_id: this.replay_id,
				killer: data.killer,
				killer_name: this.gameState.usernames[data.killer]
			}
		})
		this.leaveGame()
	}

	private handleGameWon = () => {
		Log.stdout(`[game_won] ${this.replay_id}`)
		this.redis.sendUpdate({
			game_won: {
				replay_id: this.replay_id
			}
		})
		this.leaveGame()
	}

	private handleQueueUpdate = (data: GeneralsIO.QueueUpdate) => {
		if (!data.isForcing) {
			this.forceStartSet = false
			setTimeout(this.setForceStart, 1000)
		}
		// if we are the first player in the queue and number of players has changed, set the game speed
		if (this.gameType === Game.Type.CUSTOM
			&& data.usernames[0] === this.gameConfig.username
			&& data.numPlayers != this.queueNumPlayers
			&& data.options.game_speed != this.gameConfig.customGameSpeed) {
			this.customOptionsSet = false
			later(100).then(() => {
				this.setCustomOptions(this.gameConfig.customGameSpeed)
			})
		}
		this.queueNumPlayers = data.numPlayers
	}

	private joinGame = (data: RedisData.Command.Join) => {
		this.gameType = data.gameType as Game.Type
		switch (data.gameType) {
			case Game.Type.FFA:
				this.socket.emit('play', this.gameConfig.userId)
				Log.stdout('[joined] FFA')

				break
			case Game.Type.DUEL:
				this.socket.emit('join_1v1', this.gameConfig.userId)
				Log.stdout('[joined] 1v1')
				break
			case Game.Type.CUSTOM:
				if (data.gameId) {
					this.gameConfig.customGameId = data.gameId
				}
				this.socket.emit('join_private', data.gameId, this.gameConfig.userId)
				setTimeout(this.setCustomOptions, 100)
				setTimeout(this.setForceStart, 2000)
				Log.stdout(`[joined] custom: ${this.gameConfig.customGameId}`)
				break
			default:
				Log.stderr(`[join] invalid gameType: ${data.gameType}`)
				return
		}
		this.redis.sendUpdate({ joined: data })
		this.gamePhase = Game.Phase.JOINED_LOBBY
	}

	private leaveGame = () => {
		if (this.gamePhase == Game.Phase.JOINED_LOBBY) {
			this.socket.emit('cancel')
			Log.debug('sent: cancel')
		} else if (this.gamePhase == Game.Phase.PLAYING) {
			this.socket.emit('leave_game')
			Log.debug('sent: leave_game')
		} else {
			Log.stderr(`[leaveGame] Invalid Request, Current State: ${this.gamePhase}`)
			return
		}
		this.redis.sendUpdate({ left: true })
		this.gamePhase = Game.Phase.CONNECTED
		this.forceStartSet = false
		this.customOptionsSet = false
	}

	private setForceStart = () => {
		// use mutex to ensure that we only set force start once
		if (!this.forceStartSet) {
			this.forceStartSet = true
			this.socket.emit('set_force_start', this.gameConfig.customGameId, true)
			Log.debug('sent: set_force_start')
		}
	}

	private setCustomOptions = (customGameSpeed: number) => {
		// use mutex to ensure that we only set custom options once
		if (this.gameType != Game.Type.CUSTOM) return
		if (!this.customOptionsSet) {
			this.customOptionsSet = true
			this.socket.emit('set_custom_options', this.gameConfig.customGameId, {
				"game_speed": this.gameConfig.customGameSpeed
			})
			Log.debug('sent: set_custom_options')
		}
	}

	public quit = async () => {
		Log.stdout('quitting')
		switch (this.gamePhase) {
			case Game.Phase.JOINED_LOBBY:
			case Game.Phase.PLAYING:
				this.socket.emit('leave_game')
				Log.debug('sent: leave_game')
		}
		await this.socket.disconnect()
		this.redis.quit()
	}
}
