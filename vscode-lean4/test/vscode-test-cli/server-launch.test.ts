import * as assert from 'node:assert'
import * as path from 'node:path'
import { Uri, commands, workspace } from 'vscode'
import { activateExtension } from '../helpers/activation'
import { openInEditor } from '../helpers/editors'
import { hasError, waitForDiagnostics, waitForDiagnosticsAfter } from '../helpers/lsp'
import { afterEachReset } from '../helpers/teardown'
import { FIRST_DIAGS_TIMEOUT_MS, RESTART_DIAGS_TIMEOUT_MS } from '../helpers/timeouts'

describe('Language server — launch and restart', function () {
    this.timeout(FIRST_DIAGS_TIMEOUT_MS + 60_000)

    let uri: Uri

    before(async () => {
        await activateExtension()

        const folder = workspace.workspaceFolders?.[0]
        assert.ok(folder, 'a workspace folder must be open')
        uri = Uri.file(path.join(folder.uri.fsPath, 'Main.lean'))
    })

    // Each test starts from "Main.lean is open and the server has produced at
    // least one error diagnostic for it", regardless of what previous tests
    // left behind. `FIRST_DIAGS_TIMEOUT_MS` covers a cold toolchain install in
    // case this test happens to run first; subsequent diagnostics assertions
    // inside each test use the shorter `RESTART_DIAGS_TIMEOUT_MS`.
    beforeEach(async () => {
        await openInEditor(uri)
        await waitForDiagnostics(uri, hasError, FIRST_DIAGS_TIMEOUT_MS, 'initial')
    })

    afterEach(afterEachReset)

    it('launches the server and produces an error diagnostic on the fixture', async () => {
        // Preconditions from beforeEach already cover the launch path; this
        // case simply records that getting to steady state works end-to-end.
        assert.ok(hasError(await waitForDiagnostics(uri, hasError, RESTART_DIAGS_TIMEOUT_MS, 'steady')))
    })

    // The restart tests use `waitForDiagnosticsAfter` (NOT `waitForDiagnostics`)
    // on purpose: the diagnostics from `beforeEach` already match `hasError`,
    // so a no-op restart impl would short-circuit `waitForDiagnostics` and
    // pass. `waitForDiagnosticsAfter` subscribes before the action and only
    // resolves on a post-action fire — a real `restartFile`/`restartServer`
    // does didClose+didOpen, which republishes; a no-op produces no fires
    // and the helper times out.
    it('restarts the current file via lean4.restartFile and still reports the error', async () => {
        const diags = await waitForDiagnosticsAfter(
            uri,
            () => commands.executeCommand('lean4.restartFile'),
            hasError,
            RESTART_DIAGS_TIMEOUT_MS,
            'after-restartFile',
        )
        assert.ok(hasError(diags))
    })

    it('restarts the server via lean4.restartServer and still reports the error', async () => {
        const diags = await waitForDiagnosticsAfter(
            uri,
            () => commands.executeCommand('lean4.restartServer'),
            hasError,
            RESTART_DIAGS_TIMEOUT_MS,
            'after-restartServer',
        )
        assert.ok(hasError(diags))
    })
})
