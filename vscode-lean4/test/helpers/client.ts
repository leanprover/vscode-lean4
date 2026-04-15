import * as path from 'node:path'
import { Uri } from 'vscode'
import type { LeanClient } from '../../src/leanclient'
import type { LeanClientProvider } from '../../src/utils/clientProvider'
import { activateExtension } from './activation'
import { openInEditor } from './editors'
import { pollFor, withTimeout } from './timeouts'

// Returns the `LeanClientProvider` of the extension. After the first call (in
// `teardown.ts`), `activateExtension` only returns the exports.
export async function getClientProvider(): Promise<LeanClientProvider> {
    const { clientProvider } = await (await activateExtension()).lean4EnabledFeatures
    return clientProvider
}

// Returns the Lean client whose project folder is `folder`, if there is one.
export async function clientForFolder(folder: string): Promise<LeanClient | undefined> {
    const clientProvider = await getClientProvider()
    return clientProvider.getClients().find(client => {
        const clientFolder = client.getClientFolder()
        return clientFolder.scheme === 'file' && path.relative(clientFolder.fsPath, folder) === ''
    })
}

// Waits until the Lean client of the active editor runs, so that a `lean4.*`
// command that needs the client does not fail.
//
// The extension has no event for this, and diagnostics cannot show it: a file
// that opens again gets no new diagnostics, and a file without errors has none.
// Thus we poll `isRunning()` and `isRestarting()`. `running` becomes true
// before `restart()` ends, and a project action during a restart fails with
// "Cannot run project action while restarting the server".
async function waitForActiveClient(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    // `lean4EnabledFeatures` never resolves if a precondition check of the
    // extension failed, so this wait needs the deadline too.
    const clientProvider = await withTimeout(
        getClientProvider(),
        timeoutMs,
        'the Lean 4 features of the extension (did a precondition check fail?)',
    )
    await pollFor(
        () => {
            const client = clientProvider.getActiveClient()
            if (!client || !client.isRunning() || client.isRestarting()) return undefined
            return true
        },
        Math.max(deadline - Date.now(), 0),
        'an active Lean client',
    )
}

// Opens `uri` in the editor group and waits for a running Lean client for the
// project that contains it. It combines the two steps, so that the test files
// do not repeat `openInEditor(uri)` and `waitForActiveClient`.
export async function openAndAwaitClient(uri: Uri, timeoutMs: number): Promise<void> {
    await openInEditor(uri)
    await waitForActiveClient(timeoutMs)
}
