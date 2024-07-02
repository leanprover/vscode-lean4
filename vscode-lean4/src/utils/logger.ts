class Logger {
    private static now(): string {
        const now = new Date()
        return (
            String(now.getUTCHours()).padStart(2, '0') +
            ':' +
            String(now.getMinutes()).padStart(2, '0') +
            ':' +
            String(now.getUTCSeconds()).padStart(2, '0') +
            '.' +
            String(now.getMilliseconds()).padStart(3, '0')
        )
    }

    log(msg: string) {
        console.log(Logger.now(), '-', msg)
    }

    error(msg: string) {
        console.error(Logger.now(), '-', msg)
    }
}

const logger = new Logger()
export { logger }