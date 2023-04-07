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

	static stdout(...args: string[]) {
		console.log(new Date().toISOString(), args.join(' '))
	}

	static stderr(...args: string[]) {
		console.error(new Date().toISOString(), args.join(' '))
	}

	static debug(...args: string[]) {
		if (!Log.debugEnabled) return
		console.error(new Date().toISOString(), args.join(' '))
	}

	static debugObject(obj: any) {
		if (!Log.debugEnabled) return
		console.error(JSON.stringify(obj, null, 2))
	}

}
