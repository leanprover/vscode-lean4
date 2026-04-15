import { commands, TextDocument, workspace } from 'vscode'

// Types `text` character by character via the built-in `type` command (same path
// real keystrokes take), yielding between characters so the abbreviation rewriter
// can process each change event before the next input arrives.
export async function typeChars(text: string): Promise<void> {
    for (const ch of text) {
        await commands.executeCommand('type', { text: ch })
        await new Promise(resolve => setImmediate(resolve))
    }
}

// Sends the Backspace key `count` times via VS Code's `deleteLeft` command —
// the same code path real Backspace keystrokes take, so the abbreviation
// rewriter sees a `processChange` event for each deletion. Yields between
// keystrokes for the same reason as `typeChars`.
export async function backspace(count: number = 1): Promise<void> {
    for (let i = 0; i < count; i++) {
        await commands.executeCommand('deleteLeft')
        await new Promise(resolve => setImmediate(resolve))
    }
}

// Waits until `predicate(document.getText())` holds, or throws after `timeoutMs`.
// Logs the observed text on each document change.
export async function waitForText(
    doc: TextDocument,
    predicate: (text: string) => boolean,
    timeoutMs = 2000,
    label = 'text',
): Promise<string> {
    return new Promise((resolve, reject) => {
        const check = () => {
            const text = doc.getText()
            if (predicate(text)) {
                sub.dispose()
                clearTimeout(timer)
                resolve(text)
                return true
            }
            return false
        }
        const sub = workspace.onDidChangeTextDocument(e => {
            if (e.document !== doc) return
            console.log(`[${label}] ${JSON.stringify(doc.getText())}`)
            check()
        })
        const timer = setTimeout(() => {
            sub.dispose()
            reject(
                new Error(
                    `[${label}] timed out after ${timeoutMs}ms; last text was ${JSON.stringify(doc.getText())}`,
                ),
            )
        }, timeoutMs)
        check()
    })
}
