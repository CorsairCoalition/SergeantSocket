import { Command } from 'commander'
import { Log } from './utils.js'
import { App } from './app.js'
import fs from 'node:fs/promises'

const packageJsonPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))

Log.stdout(`[initilizing] ${pkg.name} v${pkg.version}`)

let app: App

// command line parser
const program = new Command()
program
	.name(pkg.name)
	.version(pkg.version)
	.description(pkg.description)
	.option('-d, --debug', 'enable debugging', false)
	.option('-s, --set-username', `attempt to set username`, false)
	.arguments('<configFile>')
	.showHelpAfterError()
	.action(run)

async function run(configFile: string) {
	// read and process command line options
	const options = program.opts()
	const config = JSON.parse(await fs.readFile(configFile, 'utf8'))
	const gameConfig = config.gameConfig
	const redisConfig = config.redisConfig
	gameConfig.BOT_ID_PREFIX = gameConfig.BOT_ID_PREFIX || 'cortex'
	gameConfig.setUsername = options['setUsername']
	Log.setDebugOutput(options['debug'])

	// debug output
	Log.debug("[debug] debugging enabled")
	Log.debugObject('Game configuration', gameConfig)
	Log.debugObject('Command Line Options', options)

	// start the application to initiate redis and socket connections
	app = new App(gameConfig, redisConfig)
	Log.stdout(`[initilizing] botId: ${app.botId}`)
}

await program.parseAsync()

// gracefully exit on SIGINT and SIGTERM
process.once('SIGINT', async () => {
	Log.stderr('Interrupted. Exiting gracefully.')
	await app?.quit()
})

process.once('SIGTERM', async () => {
	Log.stderr('Terminated. Exiting gracefully.')
	await app?.quit()
})

process.on('exit', () => {
	Log.stderr('Exiting now.')
})
