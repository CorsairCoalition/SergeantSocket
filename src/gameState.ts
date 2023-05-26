/// <reference path="./app.d.ts" />

import { patch } from './gameUtils.js'

export class GameState {
	playerIndex: number
	replay_id: string
	usernames: string[]
	private map: number[] = []
	turn: number
	width: number
	height: number
	size: number
	armies: number[]
	terrain: number[]
	cities: number[] = []
	ownGeneral: number = -1
	enemyGeneral: number = -1
	ownTiles: Map<number, number> = new Map()
	enemyTiles: Map<number, number> = new Map()
	discoveredTiles: boolean[]
	initialized: boolean = false

	constructor(data: GeneralsIO.GameStart) {
		this.playerIndex = data.playerIndex
		this.replay_id = data.replay_id
		this.usernames = data.usernames
	}

	update(data: GeneralsIO.GameUpdate) {
		this.cities = patch(this.cities, data.cities_diff)
		this.map = patch(this.map, data.map_diff)
		this.turn = data.turn

		if (!this.initialized) {
			this.initialized = true
			// The first two terms in |map| are the dimensions.
			this.width = this.map[0]
			this.height = this.map[1]
			this.size = this.width * this.height
			this.discoveredTiles = Array.apply(null, Array(this.size)).map(() => false)
		}

		// The next |size| terms are army values.
		// armies[0] is the top-left corner of the map.
		this.armies = this.map.slice(2, this.size + 2)

		// The last |size| terms are terrain values.
		// terrain[0] is the top-left corner of the map.
		this.terrain = this.map.slice(this.size + 2, this.size + 2 + this.size)

		this.updatePlayerTiles()
		this.updateDiscoveredTiles()
		this.updateGenerals(data.generals)
	}

	updatePlayerTiles() {
		this.ownTiles.clear()
		this.enemyTiles.clear()
		for (let i = 0; i < this.terrain.length; i++) {
			let tile = this.terrain[i]
			if (tile >= 0) {
				let armies = this.armies[i]
				if (tile == this.playerIndex) {
					this.ownTiles.set(i, armies)
				} else {
					this.enemyTiles.set(i, armies)
				}
			}
		}
	}

	//store tiles, that have already been discovered, even if being recaptured or disguised
	updateDiscoveredTiles() {
		for (let i = 0; i < this.terrain.length; i++) {
			if (!this.discoveredTiles[i]) {
				if (this.ownTiles.has(i) || this.enemyTiles.has(i)) {
					this.discoveredTiles[i] = true
				}
			}
		}
	}

	// TODO: support multiple enemies
	updateGenerals(generals: number[]) {
		for (let general of generals) {
			if (general != -1) {
				if (this.ownGeneral == -1) {
					this.ownGeneral = general
				} else if (general != this.ownGeneral) {
					this.enemyGeneral = general
				}
			}
		}
	}
}
