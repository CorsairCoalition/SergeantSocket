// interface Log {
// 	stdout: (msg: string) => void,
// 	stderr: (msg: string) => void,
// 	debug: (msg: string) => void,
// 	redis: (channel: REDIS_CHANNEL, msgObj: object) => void,
// }

export function later(delay: number) {
	return new Promise(function (resolve) {
		setTimeout(resolve, delay)
	})
}

export function random(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1) + min)
}

export class Log {

	static debugEnabled: boolean = false

	static setDebugOutput(debug: boolean) {
		Log.debugEnabled = debug
	}

	static stdout (msg: string) {
		console.log(new Date().toISOString(), msg)
	}

	static stderr (msg: string) {
		console.error(new Date().toISOString(), msg)
	}

	static debug(msg: string) {
		if (Log.debugEnabled)
			console.error(new Date().toISOString(), msg)
	}

}
