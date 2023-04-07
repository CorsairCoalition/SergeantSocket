import { createClient } from 'redis'
import { Log } from './utils.js'
import { GameState } from './gameState.js'
import { RedisClientType } from 'redis'

enum KEYS {
	TURN = 'turn',
	MAP = 'map',
	WIDTH = 'width',
	HEIGHT = 'height',
	SIZE = 'size',
	TEAMS = 'teams',
	SCORES = 'scores',
	PLAYER_INDEX = 'playerIndex',
	REPLAY_ID = 'replay_id',
	USERNAMES = 'usernames',
	CHAT_ROOM = 'chat_room',
	CITIES = 'cities',
	DISCOVERED_TILES = 'discoveredTiles',
	ARMIES = 'armies',
	ENEMY_GENERAL = 'enemyGeneral',
	OWN_GENERAL = 'ownGeneral',
	OWN_TILES = 'ownTiles',
	ENEMY_TILES = 'enemyTiles',
}

enum CHANNEL {
	COMMAND = 'command',
	STATE = 'state',
	ACTION = 'action',
	RECOMMENDATION = 'recommendation',
	DECONFLICT = 'deconflict',
}

export class Redis {
	private publisher: RedisClientType
	private subscriber: RedisClientType
	private CHANNEL_PREFIX: string
	private gameKeyspace: string
	private gameStarted: boolean = false
	private deconflicted = false

	constructor(redisConfig: Config.Redis) {
		this.CHANNEL_PREFIX = redisConfig.CHANNEL_PREFIX
		this.subscriber = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.subscriber.on('error', (error: Error) => Log.stderr(`[Redis] {error}`))
		this.subscriber.connect()

		this.publisher = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.publisher.on('error', (error: Error) => Log.stderr(`[Redis] ${error}`))
		this.publisher.connect()
	}

	// deconflict with Redis pub/sub to ensure globally unique botId
	public deconflict() {
		// ensure this function is only called once
		if (this.deconflicted) return
		this.deconflicted = true

		let CHANNEL_NAME = this.CHANNEL_PREFIX + CHANNEL.DECONFLICT
		enum MESSAGE {
			PING = "ping",
			PONG = "pong",
		}
		let countResponses = 0
		let startPing = Date.now()
		this.subscriber.subscribe(CHANNEL_NAME, (message: string) => {
			if (message === MESSAGE.PING) {
				this.publisher.publish(CHANNEL_NAME, MESSAGE.PONG)
			}
			else if (message === MESSAGE.PONG) {
				countResponses++
				if (countResponses === 2) {
					let ping = Date.now() - startPing
					// if we get a second response within 10 seconds, someone else is on the same channel
					if (ping < 10000) {
						// display error message and exit
						Log.stderr("Deconfliction failed. Select a unique userId and try again.")
						process.exit(15)
					}
				}
			}
		}).then(() => {
			this.publisher.publish(CHANNEL_NAME, "ping")
		})
	}

	public sendUpdate(data: RedisData.State) {
		return this.publisher.publish(this.CHANNEL_PREFIX + CHANNEL.STATE, JSON.stringify(data))
	}

	public createGameKeyspace(gameStart: GeneralsIO.GameStart): Promise<string> {
		this.gameKeyspace = `{BOT_CLASS}-{this.botId}-${gameStart.replay_id}`
		this.gameStarted = false
		// @ts-ignore GameStart translates to RedisJSON but TypeScript doesn't know that
		let promise: Promise = this.publisher.json.set(this.gameKeyspace, "$", gameStart)
		// return the promise that resolves with `gameKeyspace`
		return promise.then(() => this.gameKeyspace)
	}

	public updateGameData(gameState: GameState) {
		if (!this.gameStarted) {
			this.gameStarted = true
			this.publisher.json.set(this.gameKeyspace, KEYS.WIDTH, gameState.width)
			this.publisher.json.set(this.gameKeyspace, KEYS.HEIGHT, gameState.height)
			this.publisher.json.set(this.gameKeyspace, KEYS.SIZE, gameState.size)
			this.publisher.json.set(this.gameKeyspace, KEYS.OWN_GENERAL, gameState.ownGeneral)
		}

		this.publisher.json.set(this.gameKeyspace, KEYS.CITIES, gameState.cities)
		this.publisher.json.set(this.gameKeyspace, KEYS.MAP, gameState.map)
		this.publisher.json.set(this.gameKeyspace, KEYS.DISCOVERED_TILES, gameState.discoveredTiles)
		this.publisher.json.set(this.gameKeyspace, KEYS.ARMIES, gameState.armies)
		this.publisher.json.set(this.gameKeyspace, KEYS.ENEMY_GENERAL, gameState.enemyGeneral)
		this.publisher.json.set(this.gameKeyspace, KEYS.TURN, gameState.turn)
		// @ts-ignore Solve this if the following type does not work; otherwise ignore.
		this.publisher.json.set(this.gameKeyspace, KEYS.OWN_TILES, gameState.ownTiles)
		// @ts-ignore Solve this if the following type does not work; otherwise ignore.
		this.publisher.json.set(this.gameKeyspace, KEYS.ENEMY_TILES, gameState.enemyTiles)
	}

	public expireKeyspace(timeInSeconds: number) {
		return this.publisher.expire(this.gameKeyspace, timeInSeconds)
	}

	public subscribeToCommands(callback: (data: RedisData.Command.Any) => void) {
		const CHANNEL_NAME: string = this.CHANNEL_PREFIX + CHANNEL.COMMAND
		let handleCommand = (message: string, channel: string) => {
			let data: RedisData.Command.Any
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr('[JSON] received:', message, ', error:', error)
				return
			}
			callback(data)
		}
		let promise: Promise<void> = this.subscriber.subscribe(CHANNEL_NAME, handleCommand)
		return promise.then(() => CHANNEL_NAME)
	}

	public subscribeToRecommendations(callback: (data: RedisData.Recommendation) => void) {
		const CHANNEL_NAME: string = this.CHANNEL_PREFIX + CHANNEL.RECOMMENDATION
		let handleRecommendation = (message: string, channel: string) => {
			let data: RedisData.Recommendation
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr('[JSON] received:', message, ', error:', error)
				return
			}
			callback(data)
		}
		let promise: Promise<void> = this.subscriber.subscribe(CHANNEL_NAME, handleRecommendation)
		return promise.then(() => CHANNEL_NAME)
	}

	public quit() {
		this.subscriber.quit()
		return this.publisher.quit()
	}
}
