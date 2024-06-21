import { env } from 'vscode'
import { displayErrorWithInput } from './notifs'

export async function displayInternalErrorsIn<T>(scope: string, f: () => Promise<T>): Promise<T> {
    try {
        return await f()
    } catch (e) {
        let msg: string
        if (e instanceof Error) {
            msg = `Internal error (while ${scope}):`
            if (e.stack === undefined) {
                msg += ` ${e.name}: ${e.message}`
            } else {
                msg += '\n\n' + e.stack
            }
        } else {
            msg = e
        }

        const copyToClipboardInput = 'Copy to Clipboard'
        const choice = await displayErrorWithInput(msg, copyToClipboardInput)
        if (choice === copyToClipboardInput) {
            await env.clipboard.writeText(msg)
        }
        throw e
    }
}
