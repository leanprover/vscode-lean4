/**
 * Comment (JE):
 *
 * In vscode-lean4, they use `import { Console } from 'console'`, which doesn't work.
 *
 * Here, we provide our custom implementation of `Console` in order to avoid modifying
 * the code in vscode-lean4.
 *
 * In particular, see
 * https://nodejs.org/api/console.html
 * for the interface specification. We only implemented the functions that are actually
 * used by the logger defined in vscode-lean4.
 */
export class Console {
    constructor(stdout: NodeJS.WritableStream, stderr?: NodeJS.WritableStream) {
        // TODO?
    }

    log(message?: any, ...optionalParams: any[]): void {
        console.log(message, ...optionalParams)
    }

    error(message?: any, ...optionalParams: any[]): void {
        console.log(message, ...optionalParams)
    }
}
