import { Console } from 'console'

class Logger extends Console {
    constructor(stdout: NodeJS.WritableStream, stderr?: NodeJS.WritableStream) {
        super(stdout, stderr);
    }

    log(msg: string) {
        super.log(new Date().toLocaleTimeString(), '-', msg);
    }

    error(msg: string) {
        super.error(new Date().toLocaleTimeString(), '-', msg);
    }
}

const logger = new Logger(process.stdout, process.stderr);
export { logger }
