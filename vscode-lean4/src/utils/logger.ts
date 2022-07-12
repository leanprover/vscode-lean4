import { Console } from 'console'
const util = require('util');

class Logger extends Console {
    constructor(stdout: NodeJS.WritableStream, stderr?: NodeJS.WritableStream) {
        super(stdout, stderr);
    }

    log(...args : any) {
        super.log(new Date().toLocaleTimeString(), '-', util.format(...args));
    }

    error(...args : any) {
        super.error(new Date().toLocaleTimeString(), '-', util.format(...args));
    }
}

const logger = new Logger(process.stdout, process.stderr);
export { logger }
