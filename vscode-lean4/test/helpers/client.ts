import { Uri, extensions } from 'vscode'
import { Exports } from '../../src/exports'
import { LeanClientProvider } from '../../src/utils/clientProvider'
import { openInEditor } from './editors'
import { pollFor } from './timeouts'

// Returns the extension's `LeanClientProvider`. Handles activation as a side
// effect so callers can use this as a one-stop accessor.
export async function getClientProvider(): Promise<LeanClientProvider> {
    const ext = extensions.getExtension('leanprover.lean4')
    if (!ext) throw new Error('leanprover.lean4 extension is not available')
    const exports: Exports = await ext.activate()
    const { clientProvider } = await exports.lean4EnabledFeatures
    return clientProvider
}

// Polls until the active editor's Lean client is up and accepting requests,
// so a subsequent `commands.executeCommand('lean4.…')` won't no-op on a
// missing/unstarted client.
//
// `LeanClient.isRunning()` is a deliberate exception to the
// "no LeanClient internals in tests" rule (`memory/feedback_test_no_leanclient_internals.md`).
// Public alternatives don't fit:
//   - `languages.onDidChangeDiagnostics` doesn't fire on an idempotent
//     `openTextDocument` re-open, so subsequent opens of the same URI
//     within a file would hang here.
//   - `languages.getDiagnostics(uri)` returns `[]` both for "never
//     published" and "published clean," so a sync short-circuit can't
//     tell them apart.
// If `LeanClientProvider` grows a public `clientStarted` event, switch to
// that and remove this poll.
async function waitForActiveClient(timeoutMs: number): Promise<void> {
    const clientProvider = await getClientProvider()
    await pollFor(
        () => {
            const client = clientProvider.getActiveClient()
            return client && client.isRunning() ? true : undefined
        },
        timeoutMs,
        'an active Lean client',
    )
}

// Opens `uri` in the editor group and waits for a running Lean client for the
// project that contains it. Combines the two steps so suites don't repeat the
// `openInEditor(uri)` + `waitForActiveClient` pattern inline.
export async function openAndAwaitClient(uri: Uri, timeoutMs: number): Promise<void> {
    await openInEditor(uri)
    await waitForActiveClient(timeoutMs)
}
