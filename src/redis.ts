import { createClient } from 'redis'
import { Log } from './utils'
import { GameState } from './gameState'

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
}

enum CHANNEL {
	COMMAND = 'command',
	STATE = 'state',
	ACTION = 'action',
	RECOMMENDATION = 'recommendation',
}

export class Redis {
	private publisher
	private redisSubscriber
	private gameKeyspace: string
	private gameStarted: boolean = false

	constructor(redisConfig, gameConfig) {

		this.redisSubscriber = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.redisSubscriber.on('error', (error: Error) => Log.stderr(`[Redis] {error}`))
		this.redisSubscriber.connect()

		this.publisher = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.publisher.on('error', (error: Error) => Log.stderr(`[Redis] {error}`))
		this.publisher.connect()
	}

	public async sendUpdate(data: RedisData.State) {
		return this.publisher.publish(`{BOT_CLASS}-{gameConfig.botId}-{CHANNEL.STATE}`, JSON.stringify(data))
	}

	public async createKeyspace(gameStart: GeneralsIO.GameStart) {
		this.gameKeyspace = `{BOT_CLASS}-{gameConfig.botId}-${gameStart.replay_id}`
		this.publisher.json.set(this.gameKeyspace, "$", gameStart)
		this.gameStarted = false
	}

	public async setKeys(gameState: GameState) {
		if(!this.gameStarted){
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
		// redisClient.json.set(this.gameKeyspace, KEYS.OWN_TILES, gameState.ownTiles)
		// redisClient.json.set(this.gameKeyspace, KEYS.ENEMY_TILES, gameState.enemyTiles)
	}

	public async expireKeyspace() {
		const ONE_DAY = 60 * 60 * 24
		this.publisher.expire(this.gameKeyspace, ONE_DAY)
	}

	public async subscribeToCommands(callback: (data: RedisData.Command) => void) {
		this.redisSubscriber.subscribe(`{BOT_CLASS}-{gameConfig.botId}-{CHANNEL.COMMAND}`, (channel: string, message: string) => {
			let data: RedisData.Command
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr(`[JSON] {error}`)
				return
			}
			callback(data)
		})
	}

	public async subscribeToRecommendations(callback: (data: RedisData.Recommendation) => void) {
		this.redisSubscriber.subscribe(`{BOT_CLASS}-{gameConfig.botId}-{CHANNEL.RECOMMENDATION}`, (channel: string, message: string) => {
			let data: RedisData.Recommendation
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr(`[JSON] {error}`)
				return
			}
			callback(data)
		})
	}

	public async quit() {
		this.redisSubscriber.quit()
		return this.publisher.quit()
	}
}
