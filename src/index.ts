import { Command } from 'commander'
import { Log } from './utils.js'
import { App } from './app.js'
import fs from 'node:fs/promises'

// read configuration files
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
const config = JSON.parse(await fs.readFile('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig
gameConfig.BOT_CLASS = 'cortex'

Log.stdout(`[initilizing] ${pkg.name} v${pkg.version}`)

// command line parser
const program = new Command()
program
	.name(pkg.name)
	.version(pkg.version)
	.description(pkg.description)
	.option('-d, --debug', 'enable debugging', false)
	.option('-s, --set-username', `attempt to set username: ${gameConfig.username}`, false)
	.showHelpAfterError()
	.parse()

// read and process command line options
const options = program.opts()
gameConfig.setUsername = options.setUsername
Log.setDebugOutput(options.debug)

// debug output
Log.debug("[debug] debugging enabled")
Log.debug("[debug] gameConfig: ")
Log.debugObject(gameConfig)
Log.debug("[debug] options: ")
Log.debugObject(options)

// start the application to initiate redis and socket connections
let app = new App(gameConfig, redisConfig)
Log.stdout(`[initilizing] botId: ${app.botId}`)

// gracefully exit on SIGINT and SIGTERM
process.once('SIGINT', async (code) => {
	Log.stderr('Interrupted. Exiting gracefully.')
	app.quit()
})

process.once('SIGTERM', async (code) => {
	Log.stderr('Terminated. Exiting gracefully.')
	app.quit()
})
