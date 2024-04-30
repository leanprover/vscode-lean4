import { commands, window } from 'vscode'

export async function displayErrorWithOutput(message: string) {
    const input = 'Show Output'
    const choice = await window.showErrorMessage(message, input)
    if (choice === input) {
        await commands.executeCommand('lean4.troubleshooting.showOutput')
    }
}

export async function displayWarningWithOutput(message: string) {
    const input = 'Show Output'
    const choice = await window.showWarningMessage(message, input)
    if (choice === input) {
        await commands.executeCommand('lean4.troubleshooting.showOutput')
    }
}
