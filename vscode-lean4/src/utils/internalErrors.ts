import { env } from 'vscode'
import { displayNotificationWithInput } from './notifs'

export async function displayInternalErrorsIn<T>(scope: string, f: () => Promise<T>): Promise<T> {
    try {
        return await f()
    } catch (e) {
        let msg: string = `Internal error (while ${scope}): ${e}`
        let fullMsg: string = msg
        if (e instanceof Error && e.stack !== undefined) {
            fullMsg += `\n\n${e.stack}`
        }
        msg +=
            "\n\nIf you are using an up-to-date version of the Lean 4 VS Code extension, please copy the full error message using the 'Copy Error to Clipboard' button and report it at https://github.com/leanprover/vscode-lean4/ or https://leanprover.zulipchat.com/."
        const copyToClipboardInput = 'Copy Error to Clipboard'
        const choice = await displayNotificationWithInput('Error', msg, copyToClipboardInput)
        if (choice === copyToClipboardInput) {
            await env.clipboard.writeText(fullMsg)
        }
        throw e
    }
}
