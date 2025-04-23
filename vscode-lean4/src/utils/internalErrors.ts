import { env } from 'vscode'
import { displayModalNotification, displayNotificationWithInput } from './notifs'

export async function displayInternalError(scope: string, e: any) {
    let msg: string = `Internal error (while ${scope}): ${e}`
    let fullMsg: string = msg
    if (e instanceof Error && e.stack !== undefined) {
        fullMsg += `\n\n${e.stack}`
    }
    msg +=
        "\n\nIf you are using an up-to-date version of the Lean 4 VS Code extension, please copy the full error message using the 'Copy Error to Clipboard' button and report it at https://github.com/leanprover/vscode-lean4/ or https://leanprover.zulipchat.com/."
    const copyToClipboardInput = 'Copy Error to Clipboard'
    const closeInput = 'Close'
    const choice = await displayNotificationWithInput('Error', msg, [copyToClipboardInput], closeInput)
    if (choice === copyToClipboardInput) {
        await env.clipboard.writeText(fullMsg)
    }
}

const duplicateCommandError = (scope: string) =>
    `Error (while ${scope}): Two separate Lean 4 VS Code extensions that register the same VS Code functionality are installed.
Please uninstall or disable one of them and restart VS Code.

The 'Lean 4' extension by the 'leanprover' organization is the only official Lean 4 VS Code extension.`

export async function displayInternalErrorsIn<T>(scope: string, f: () => Promise<T>): Promise<T> {
    try {
        return await f()
    } catch (e) {
        const msg = e.message
        if (msg !== undefined && typeof msg === 'string' && msg.match(/command '.*' already exists/)) {
            await displayModalNotification('Error', duplicateCommandError(scope))
            throw e
        }
        await displayInternalError(scope, e)
        throw e
    }
}
