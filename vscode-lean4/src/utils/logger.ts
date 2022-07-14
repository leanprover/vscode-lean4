import { Console } from 'console'

class Logger extends Console {
    constructor(stdout: NodeJS.WritableStream, stderr?: NodeJS.WritableStream) {
        super(stdout, stderr);
    }

    private static now(): string {
		const now = new Date();
		return String(now.getUTCHours()).padStart(2, '0')
			+ ':' + String(now.getMinutes()).padStart(2, '0')
			+ ':' + String(now.getUTCSeconds()).padStart(2, '0') + '.' +
            String(now.getMilliseconds()).padStart(3, '0');
    }

    log(msg: string) {
        super.log(Logger.now(), '-', msg);
    }

    error(msg: string) {
        super.error(Logger.now(), '-', msg);
    }
}

const logger = new Logger(process.stdout, process.stderr);
export { logger }
