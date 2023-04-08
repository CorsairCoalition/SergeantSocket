/// <reference path="./app.d.ts" />

import { createClient, RedisClientType } from '@redis/client'
import { Log } from './utils.js'
import { GameState } from './gameState.js'

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

	public setGameKeys(keyValues: Record<string, any>) {
		// JSON.stringify each value
		for (let key in keyValues) {
			keyValues[key] = JSON.stringify(keyValues[key])
		}
		return this.publisher.hSet(this.gameKeyspace, keyValues)
	}

	public async getGameKeys(...keys: Array<string>) {
		// JSON.parse each value
		let values = await this.publisher.hmGet(this.gameKeyspace, keys)
		for (let key in values) {
			values[key] = JSON.parse(values[key])
		}
		return values
	}

	public async getAllGameKeys() {
		// JSON.parse each value
		let values = await this.publisher.hGetAll(this.gameKeyspace)
		for (let key in values) {
			values[key] = JSON.parse(values[key])
		}
		return values
	}

	public expireKeyspace(timeInSeconds: number) {
		return this.publisher.expire(this.gameKeyspace, timeInSeconds)
	}

	// deconflict with Redis pub/sub to ensure globally unique botId
	public deconflict() {
		// ensure this function is only called once
		if (this.deconflicted) return
		this.deconflicted = true

		let CHANNEL_NAME = this.CHANNEL_PREFIX + '-' + RedisData.CHANNEL.DECONFLICT
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

	public sendUpdate(channel: RedisData.CHANNEL, data: any) {
		return this.publisher.publish(this.CHANNEL_PREFIX + '-' + channel, JSON.stringify(data))
	}

	public async createGameKeyspace(gameStart: GeneralsIO.GameStart) {
		this.gameKeyspace = `${this.CHANNEL_PREFIX}-${gameStart.replay_id}`
		this.gameStarted = false
		await this.setGameKeys(gameStart)
		await this.expireKeyspace(60 * 60 * 24)
		return this.gameKeyspace
	}

	public updateGameData(gameState: GameState) {
		if (!this.gameStarted) {
			this.gameStarted = true
			this.setGameKeys({
				[RedisData.KEY.WIDTH]: gameState.width,
				[RedisData.KEY.HEIGHT]: gameState.height,
				[RedisData.KEY.SIZE]: gameState.size,
				[RedisData.KEY.OWN_GENERAL]: gameState.ownGeneral,
			})
		}
		return this.setGameKeys({
			[RedisData.KEY.TURN]: gameState.turn,
			[RedisData.KEY.CITIES]: gameState.cities,
			[RedisData.KEY.MAP]: gameState.map,
			[RedisData.KEY.DISCOVERED_TILES]: gameState.discoveredTiles,
			[RedisData.KEY.ARMIES]: gameState.armies,
			[RedisData.KEY.ENEMY_GENERAL]: gameState.enemyGeneral,
			[RedisData.KEY.OWN_TILES]: gameState.ownTiles,
			[RedisData.KEY.ENEMY_TILES]: gameState.enemyTiles,
		})
	}

	public async subscribe(channel: RedisData.CHANNEL, callback: (data: any) => void) {
		const CHANNEL_NAME: string = this.CHANNEL_PREFIX + '-' + channel
		let handleResponse = (message: string, channel: string) => {
			let data: RedisData.Recommendation
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr('[JSON] received:', message, ', error:', error)
				return
			}
			callback(data)
		}
		await this.subscriber.subscribe(CHANNEL_NAME, handleResponse)
		return CHANNEL_NAME
	}

	public quit() {
		this.subscriber.quit()
		return this.publisher.quit()
	}
}
