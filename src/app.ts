// imports
import { Command } from 'commander'
import { createClient } from 'redis'
import io from 'socket.io-client'

import fs from 'node:fs/promises'

// configuration

const BOT_CLASS = 'cortex'
const GAME_SERVER_URL = 'wss://botws.generals.io/'
const DEFAULT_NUMBER_OF_GAMES = 3
const DEFAULT_CUSTOM_GAME_SPEED = 4

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
const config = JSON.parse(await fs.readFile('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig

// create a unique botId by hashing gameConfig.userId
gameConfig.botId = require('crypto').createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
gameConfig.customGameSpeed = gameConfig.customGameSpeed || DEFAULT_CUSTOM_GAME_SPEED
const REDIS_CHANNEL = {
	COMMAND: BOT_CLASS + '-' + gameConfig.botId + '-command',
	STATE: BOT_CLASS + '-' + gameConfig.botId + '-state',
	ACTION: BOT_CLASS + '-' + gameConfig.botId + '-action',
	RECOMMENDATION: BOT_CLASS + '-' + gameConfig.botId + '-recommendation',
}

// utilities and program flow

function later(delay: number) {
	return new Promise(function (resolve) {
		setTimeout(resolve, delay)
	})
}

function random(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1) + min)
}

interface Log {
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
	debug: (msg: string) => void,
	redis: (msg: string) => void,
}

const log: Log = {
	stdout: (msg: string) => console.log(new Date().toISOString(), msg),
	stderr: (msg: string) => console.error(new Date().toISOString(), msg),
	debug: (msg: string) => { if (options.debug) console.error(new Date().toISOString(), msg) },
	redis: (msg: string) => redisClient.publish(REDIS_CHANNEL.STATE, msg),
}

process.once('SIGINT', async (code) => {
	log.stderr('Interrupted. Exiting gracefully.')
	if (gameState === GameState.PLAYING || gameState === GameState.JOINED_LOBBY) {
		await socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redisClient.quit()
})

process.once('SIGTERM', async (code) => {
	log.stderr('Terminated. Exiting gracefully.')
	if (gameState === GameState.PLAYING || gameState === GameState.JOINED_LOBBY) {
		socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redisClient.quit()
})

// data structures and definitions

const enum GameType {
	FFA,
	OneVsOne,
	Custom
}

const enum GameState {
	INITIALIZING,
	CONNECTED,
	JOINED_LOBBY,
	PLAYING,
}

// TODO: get rid of global variables
let gameState: GameState = GameState.INITIALIZING
let playerIndex: number
let replay_id: string = ""
let usernames: string[]
// let currentGameNumber: number = 0
let queueNumPlayers: number = 0

// mutex variables
let forceStartSet: boolean = false
let customOptionsSet: boolean = false

// redis setup

const redisClient = createClient({
	url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
	socket: {
		tls: true,
		servername: redisConfig.HOST,
	}
})
redisClient.on('error', (error: Error) => console.error('[Redis]', error))
redisClient.connect()

// TODO: deconflict with Redis pub/sub to ensure globally unique botId

// socket.io setup

let socket = io(GAME_SERVER_URL, {
	rejectUnauthorized: false,
	transports: ['websocket']
})

socket.on("error", (error: Error) => console.error('[socket.io]', error))
socket.on("connect_error", (error: Error) => console.error('[socket.io]', error))

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

log.stdout(`[initilizing] ${pkg.name} v${pkg.version}`)
log.stdout(`[initilizing] botId: ${gameConfig.botId}`)

log.debug("[debug] debugging enabled")
log.debug("[debug] gameConfig: ")
log.debug(gameConfig)
log.debug("[debug] options: ")
log.debug(options.toString())

// handle game events

redisClient.subscribe(REDIS_CHANNEL.COMMAND, (message: string, channel: string) => {

	// use commands to join / leave games
	// allow setting game options
	// Commands:
	// - play - ffa / 1v1 / custom
	// - leave
	// - set game options


	let msgObj: {
		game_start?: { replay_id: string }
		join?: { gameType: string, gameId?: string }
	}
	let gameType, gameId: string

	try {
		msgObj = JSON.parse(message)
	} catch (error) {
		console.error(new Date().toISOString(), '[JSON]', error)
		return
	}

	if ('join' in msgObj) {
		joinGame(msgObj.join)
		return
	}

	if ('leave' in msgObj) {
		if (gameState === GameState.PLAYING || gameState === GameState.JOINED_LOBBY) {
			leaveGame()
		} else {
			log.stderr(`[leave] not in a game`)
		}
		return
	}

	if ('options' in msgObj) {
		if (gameState === GameState.JOINED_LOBBY) {
			customOptionsSet = false
			setTimeout(setCustomOptions, 100)
		} else {
			log.stderr(`[options] not in lobby`)
		}
		return
	}
})

redisClient.subscribe(REDIS_CHANNEL.ACTION, (message: string, channel: string) => {
	// store actions for comparison
	// select the best action and execute
})

redisClient.subscribe(REDIS_CHANNEL.RECOMMENDATION, (message: string, channel: string) => {
	// receive strategy scores and recommendations
	// use strategy weights to make the best decision
})

socket.on('connect', async () => {
	log.stdout(`[connected] ${gameConfig.username}`)
	if (options.setUsername) {
		socket.emit('set_username', gameConfig.userId, gameConfig.username)
		log.debug(`sent: set_username, ${gameConfig.userId}, ${gameConfig.username}`)
	}
	log.redis(`connected ${gameConfig.username}`)
})

socket.on('disconnect', async (reason: string) => {
	// exit if disconnected intentionally; auto-reconnect otherwise
	await log.redis('disconnected ' + reason)
	switch (reason) {
		case 'io server disconnect':
			console.error("disconnected: " + reason)
			process.exit(3)
		case 'io client disconnect':
			process.exit(0)
		default:
			console.error("disconnected: " + reason)
	}
})

socket.on('error_set_username', (message: string) => {
	if (message === '')
		log.stdout(`[set_username] username set to ${gameConfig.username}`)
	else
		log.stdout(`[error_set_username] ${message}`)
})

socket.on('game_start', (data: { playerIndex: number; replay_id: string; usernames: string[]; chat_room: string; }) => {
	// Get ready to start playing the game.
	playerIndex = data.playerIndex
	replay_id = data.replay_id
	usernames = data.usernames
	log.stdout(`[game_start] replay: ${replay_id}, users: ${usernames}`)
	log.redis('game_start ' + replay_id)

	// iterate over gameConfig.warCry to send chat messages
	// send messages at random intervals to appear more human
	for (let i = 0; i < gameConfig.warCry.length; i++) {
		later(random(i * 3000, (i + 1) * 3000)).then(() => {
			socket.emit('chat_message', data.chat_room, gameConfig.warCry[i])
			log.debug(`sent: [chat_message] ${gameConfig.warCry[i]}`)
		})
	}

	gameState = GameState.PLAYING
})

socket.on('game_update', (data: object) => {
	// TODO: update the local game state
	// TODO: publish the new state to redis
	// TODO: if number of rounds > n * 1000, leave the game
})

socket.on('game_lost', (data: { killer: string }) => {
	log.stdout(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	log.redis(`game_lost ${replay_id}, killer: ${usernames[data.killer]}`)
	leaveGame()
})

socket.on('game_won', () => {
	log.stdout(`[game_won] ${replay_id}`)
	log.redis(`game_won ${replay_id}`)
	leaveGame()
})

socket.on('queue_update', (data) => {
	if (!data.isForcing) {
		forceStartSet = false
		setTimeout(setForceStart, 1000)
	}
	// if we are the first player in the queue and number of players has changed, set the game speed
	// if (gameType === GameType.Custom
	if (data.usernames[0] === gameConfig.username
		&& data.numPlayers != queueNumPlayers
		&& data.options.game_speed != gameConfig.customGameSpeed) {
		customOptionsSet = false
		setTimeout(setCustomOptions, 100)
	}
	queueNumPlayers = data.numPlayers
})

function joinGame(data: { gameType: string, gameId?: string }) {
	switch (data.gameType) {
		case 'ffa':
			socket.emit('play', gameConfig.userId)
			log.stdout('[joined] FFA')
			log.redis('joined FFA')
			break
		case '1v1':
			socket.emit('join_1v1', gameConfig.userId)
			log.stdout('[joined] 1v1')
			log.redis('joined 1v1')
			break
		case 'custom':
			socket.emit('join_private', data.gameId, gameConfig.userId)
			setTimeout(setCustomOptions, 100)
			setTimeout(setForceStart, 2000)
			log.stdout(`[joined] custom: ${gameConfig.customGameId}`)
			log.redis(`joined custom: ${gameConfig.customGameId}`)
			break
		default:
			log.stderr(`[command] invalid gameType: ${data.gameType}`)
			return
	}
	gameState = GameState.JOINED_LOBBY
}

function leaveGame() {
	socket.emit('leave_game')
	log.debug('sent: leave_game')
	gameState = GameState.CONNECTED
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
function setCustomOptions() {
	// use mutex to ensure that we only set custom options once
	if (!customOptionsSet) {
		customOptionsSet = true
		socket.emit('set_custom_options', gameConfig.customGameId, {
			"game_speed": gameConfig.customGameSpeed
		})
		log.debug('sent: set_custom_options')
	}
}
