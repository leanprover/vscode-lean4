import * as sinon from 'sinon'
import { OpenDialogOptions, SaveDialogOptions, Uri, window } from 'vscode'

// Mirrors `withPrompts` ergonomics for `window.showSaveDialog` /
// `showOpenDialog`. The answer is a single value (not a queue) — these
// dialogs rarely fire more than once per test, so the queueing complexity
// of `withPrompts` isn't worth it. Tests that care about call count assert
// `capture.log.length` themselves.

export interface SaveDialogLog {
    options: SaveDialogOptions | undefined
    chose: Uri | undefined
}

export async function withSaveDialog<T>(
    answer: Uri | undefined,
    body: (capture: { log: SaveDialogLog[] }) => Promise<T>,
): Promise<T> {
    const log: SaveDialogLog[] = []
    const stub = sinon.stub(window, 'showSaveDialog').callsFake((async (options?: SaveDialogOptions) => {
        log.push({ options, chose: answer })
        return answer
    }) as never)
    try {
        return await body({ log })
    } finally {
        stub.restore()
    }
}

export interface OpenDialogLog {
    options: OpenDialogOptions | undefined
    chose: Uri[] | undefined
}

export async function withOpenDialog<T>(
    answer: Uri[] | undefined,
    body: (capture: { log: OpenDialogLog[] }) => Promise<T>,
): Promise<T> {
    const log: OpenDialogLog[] = []
    const stub = sinon.stub(window, 'showOpenDialog').callsFake((async (options?: OpenDialogOptions) => {
        log.push({ options, chose: answer })
        return answer
    }) as never)
    try {
        return await body({ log })
    } finally {
        stub.restore()
    }
}
