/// <reference path="./app.d.ts" />

// imports
import { Command } from 'commander'
import io from 'socket.io-client'
import { GameState } from './gameState.js'
import { Log, later, random } from './utils.js'
import { Redis } from './redis.js'

import crypto from 'crypto'
import fs from 'node:fs/promises'

// configuration

const GAME_SERVER_URL = 'wss://botws.generals.io/'
const DEFAULT_CUSTOM_GAME_SPEED = 4

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
const config = JSON.parse(await fs.readFile('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig

// create a unique botId by hashing gameConfig.userId
const BOT_CLASS = 'cortex'
let botId = crypto.createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
redisConfig.CHANNEL_PREFIX = BOT_CLASS + '-' + botId + '-'
gameConfig.customGameSpeed = gameConfig.customGameSpeed || DEFAULT_CUSTOM_GAME_SPEED


// utilities and program flow

process.once('SIGINT', async (code) => {
	log.stderr('Interrupted. Exiting gracefully.')
	if (gamePhase === Game.Phase.PLAYING || gamePhase === Game.Phase.JOINED_LOBBY) {
		await socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redis.quit()
})

process.once('SIGTERM', async (code) => {
	log.stderr('Terminated. Exiting gracefully.')
	if (gamePhase === Game.Phase.PLAYING || gamePhase === Game.Phase.JOINED_LOBBY) {
		socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redis.quit()
})

let gamePhase: Game.Phase = Game.Phase.INITIALIZING
let gameType: Game.Type
let gameState: GameState
let replay_id: string = ""
let usernames: string[]
let queueNumPlayers: number = 0

// mutex variables
let forceStartSet: boolean = false
let customOptionsSet: boolean = false

// redis setup

let redis = new Redis(redisConfig)

// TODO: deconflict with Redis pub/sub to ensure globally unique botId

// socket.io setup

let socket = io(GAME_SERVER_URL, {
	rejectUnauthorized: false,
	transports: ['websocket']
})

socket.on("error", (error: Error) => log.stderr(`[socket.io] {error}`))
socket.on("connect_error", (error: Error) => log.stderr(`[socket.io] {error}`))

// parse commands and options

const program = new Command()
program
	.name(pkg.name)
	.version(pkg.version)
	.description(pkg.description)
	.option('-d, --debug', 'enable debugging', false)
	.option('-s, --set-username', `attempt to set username: ${gameConfig.username}`, false)
	.showHelpAfterError()

program.parse()
const options = program.opts()

Log.setDebugOutput(options.debug)
let log = Log

log.stdout(`[initilizing] ${pkg.name} v${pkg.version}`)
log.stdout(`[initilizing] botId: ${botId}`)

log.debug("[debug] debugging enabled")
log.debug("[debug] gameConfig: ")
log.debug(gameConfig)
log.debug("[debug] options: ")
log.debug(options.toString())

// handle game events

redis.subscribeToCommands((command: RedisData.Command.Any) => {

	// control game: join / leave / options

	if (command.join) {
		joinGame(command.join)
		return
	}

	if (command.leave) {
		if (gamePhase === Game.Phase.PLAYING || gamePhase === Game.Phase.JOINED_LOBBY) {
			leaveGame()
		} else {
			log.stderr(`[leave] not in a game`)
		}
		return
	}

	if (command.options) {
		// if options.customGameSpeed is not defined then do nothing
		if (!options.customGameSpeed) return

		gameConfig.customGameSpeed = options.customGameSpeed
		if (gamePhase === Game.Phase.JOINED_LOBBY) {
			customOptionsSet = false
			later(100).then(() => {
				setCustomOptions(gameConfig.customGameSpeed)
			})
		} else {
			log.stderr(`[options] not in lobby`)
		}
		return
	}
}).then((gameKeyspace: string) => {
	log.stdout('[Redis] subscribed: ' + gameKeyspace)
})

redis.subscribeToRecommendations((data: RedisData.Recommendation) => {
	// TODO: push action to the game

	if (gamePhase !== Game.Phase.PLAYING) {
		log.stderr(`[recommendation] not in game`)
		return
	}
})

socket.on('connect', async () => {
	log.stdout(`[connected] ${gameConfig.username}`)
	if (options.setUsername) {
		socket.emit('set_username', gameConfig.userId, gameConfig.username)
		log.debug(`sent: set_username, ${gameConfig.userId}, ${gameConfig.username}`)
	}
	redis.sendUpdate({ connected: gameConfig.username })
})

socket.on('disconnect', async (reason: string) => {
	// exit if disconnected intentionally; auto-reconnect otherwise
	await redis.sendUpdate({ disconnected: reason })
	switch (reason) {
		case 'io server disconnect':
			log.stderr("disconnected: " + reason)
			process.exit(3)
		case 'io client disconnect':
			process.exit(0)
		default:
			log.stderr("disconnected: " + reason)
	}
})

socket.on('error_set_username', (message: string) => {
	if (message === '')
		log.stdout(`[set_username] username set to ${gameConfig.username}`)
	else
		log.stdout(`[error_set_username] ${message}`)
})

socket.on('game_start', (data: GeneralsIO.GameStart) => {
	// Get ready to start playing the game.
	replay_id = data.replay_id
	initialized = false

	log.stdout(`[game_start] replay: ${replay_id}, users: ${data.usernames}`)
	redis.sendUpdate({ game_start: data })

	gameState = new GameState(data)

	// iterate over gameConfig.warCry to send chat messages
	// send messages at random intervals to appear more human
	for (let i = 0; i < gameConfig.warCry.length; i++) {
		later(random(i * 3000, (i + 1) * 3000)).then(() => {
			socket.emit('chat_message', data.chat_room, gameConfig.warCry[i])
			log.debug(`sent: [chat_message] ${gameConfig.warCry[i]}`)
		})
	}

	gamePhase = Game.Phase.PLAYING
})

let initialized: boolean = false

socket.on('game_update', (data: GeneralsIO.GameUpdate) => {
	// update the local game state
	redis.sendUpdate({ game_update: data })
	gameState.update(data)
	redis.sendUpdate({ game_state: gameState })
	redis.updateGameData(gameState)

	// TODO: publish the new state to redis
	// TODO: if number of rounds > n * 1000, leave the game
})

socket.on('game_lost', (data: GeneralsIO.GameLost) => {
	log.stdout(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	redis.sendUpdate({
		game_lost: {
			replay_id: replay_id,
			killer: data.killer,
			killer_name: usernames[data.killer]
		}
	})
	leaveGame()
})

socket.on('game_won', () => {
	log.stdout(`[game_won] ${replay_id}`)
	redis.sendUpdate({
		game_won: {
			replay_id: replay_id
		}
	})
	leaveGame()
})

socket.on('queue_update', (data: GeneralsIO.QueueUpdate) => {
	if (!data.isForcing) {
		forceStartSet = false
		setTimeout(setForceStart, 1000)
	}
	// if we are the first player in the queue and number of players has changed, set the game speed
	if (gameType === Game.Type.CUSTOM
		&& data.usernames[0] === gameConfig.username
		&& data.numPlayers != queueNumPlayers
		&& data.options.game_speed != gameConfig.customGameSpeed) {
		customOptionsSet = false
		later(100).then(() => {
			setCustomOptions(gameConfig.customGameSpeed)
		})
	}
	queueNumPlayers = data.numPlayers
})

function joinGame(data: RedisData.Command.Join) {
	gameType = data.gameType as Game.Type
	switch (data.gameType) {
		case Game.Type.FFA:
			socket.emit('play', gameConfig.userId)
			log.stdout('[joined] FFA')

			break
		case Game.Type.DUEL:
			socket.emit('join_1v1', gameConfig.userId)
			log.stdout('[joined] 1v1')
			break
		case Game.Type.CUSTOM:
			if (data.gameId) {
				gameConfig.customGameId = data.gameId
			}
			socket.emit('join_private', data.gameId, gameConfig.userId)
			setTimeout(setCustomOptions, 100)
			setTimeout(setForceStart, 2000)
			log.stdout(`[joined] custom: ${gameConfig.customGameId}`)
			break
		default:
			log.stderr(`[join] invalid gameType: ${data.gameType}`)
			return
	}
	redis.sendUpdate({ joined: data })
	gamePhase = Game.Phase.JOINED_LOBBY
}

function leaveGame() {
	if (gamePhase == Game.Phase.JOINED_LOBBY) {
		socket.emit('cancel')
		log.debug('sent: cancel')
	} else if (gamePhase == Game.Phase.PLAYING) {
		socket.emit('leave_game')
		log.debug('sent: leave_game')
	} else {
		log.stderr(`[leaveGame] Invalid Request, Current State: ${gamePhase}`)
		return
	}
	redis.sendUpdate({ left: true })
	gamePhase = Game.Phase.CONNECTED
	forceStartSet = false
	customOptionsSet = false
}

function setForceStart() {
	// use mutex to ensure that we only set force start once
	if (!forceStartSet) {
		forceStartSet = true
		socket.emit('set_force_start', gameConfig.customGameId, true)
		log.debug('sent: set_force_start')
	}
}

// TODO: only call this function for gameType = custom
function setCustomOptions(customGameSpeed: number) {
	// use mutex to ensure that we only set custom options once
	if (!customOptionsSet) {
		customOptionsSet = true
		socket.emit('set_custom_options', gameConfig.customGameId, {
			"game_speed": gameConfig.customGameSpeed
		})
		log.debug('sent: set_custom_options')
	}
}
