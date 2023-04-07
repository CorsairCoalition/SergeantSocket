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
		is50: boolean
	}
}

declare namespace RedisData {

	interface Command {
		join?: { gameType: string, gameId?: string }
		leave?: boolean
		options?: { customGameSpeed?: number }
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