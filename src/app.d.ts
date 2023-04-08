declare namespace Game {
	const enum Phase {
		INITIALIZING = 'initializing',
		CONNECTED = 'connected',
		JOINED_LOBBY = 'joined_lobby',
		PLAYING = 'playing',
	}

	const enum Type {
		DUEL = '1v1',
		FFA = 'ffa',
		CUSTOM = 'custom',
	}
}

declare namespace GeneralsIO {
	interface QueueUpdate {
		playerIndices: number[]
		playerColors: number[]
		lobbyIndex: number
		isForcing: boolean
		numPlayers: number
		numForce: number[]
		teams: number[]
		usernames: string[]
		options: {
			chatRecordingDisabled?: boolean
			game_speed?: number
		}
	}

	interface GameStart {
		playerIndex: number
		replay_id: string
		chat_room: string
		team_chat_room: string
		usernames: string[]
		teams: number[]
		game_type: Game.Type

	}

	interface GameUpdate {
		turn: number
		map_diff: number[]
		cities_diff: number[]
		generals: number[]
		scores: object[]
		stars: number[]
	}

	interface GameLost {
		killer: number
		killer_name: string
		replay_id: string
	}

	interface GameWon {
		replay_id: string
	}

	interface ChatMessage {
		username: string
		playerIndex: number
		text: string
	}

	interface StarsRanks {
		duel?: number
		ffa?: number
	}

	interface Attack {
		start: number
		end: number
		is50?: boolean
	}
}

declare namespace RedisData {

	declare namespace Command {
		interface Join {
			gameType: string
			gameId?: string
		}

		interface Options {
			customGameSpeed?: number
		}

		interface Any {
			join?: Join
			leave?: boolean
			forceStart?: boolean
			options?: Options
		}
	}

	interface Recommendation {
		interrupt: boolean
		actions: Attack[]
	}

	interface State {
		connected?: string
		disconnected?: string
		game_start?: GeneralsIO.GameStart
		game_update?: GeneralsIO.GameUpdate
		game_state?: GameState
		game_lost?: GeneralsIO.GameLost
		game_won?: GeneralsIO.GameWon
		joined?: {
			gameType: string
			gameId?: string
		}
		left?: boolean
	}
}

declare namespace Config {
	interface Game {
		BOT_CLASS: string
		GAME_SERVER_URL: string
		MAX_TURNS: number
		userId: string
		username: string
		setUsername: boolean
		customGameId: string
		customGameSpeed: number
		warCry: string[]
	}

	interface Redis {
		HOST: string
		PORT: number
		USERNAME: string
		PASSWORD: string
		CHANNEL_PREFIX: string
	}
}
