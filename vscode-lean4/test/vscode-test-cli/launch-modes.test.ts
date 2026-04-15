import * as assert from 'node:assert'
import * as path from 'node:path'
import { Uri, workspace } from 'vscode'
import { toExtUriOrError } from '../../src/utils/exturi'
import { activateExtension } from '../helpers/activation'
import { getClientProvider } from '../helpers/client'
import { openInEditor, showInEditor } from '../helpers/editors'
import { FIXTURES } from '../helpers/fixtures'
import { hasError, waitForDiagnostics } from '../helpers/lsp'
import { afterEachReset } from '../helpers/teardown'
import { DIAGS_TIMEOUT_MS, FIRST_DIAGS_TIMEOUT_MS } from '../helpers/timeouts'

describe('Language server — launch modes', function () {
    this.timeout(FIRST_DIAGS_TIMEOUT_MS + 60_000)

    before(activateExtension)

    afterEach(afterEachReset)

    it('serves two files from separate projects with independent diagnostics', async () => {
        const a = Uri.file(path.join(FIXTURES, 'lean-project', 'Main.lean'))
        const b = Uri.file(path.join(FIXTURES, 'lean-project-b', 'Main.lean'))

        // Use `waitForDiagnostics` for plain opens: it short-circuits on the
        // current diagnostic state and falls through to event-driven waiting
        // otherwise. `waitForDiagnosticsAfter` would also work today (per-file
        // VS Code instances mean `workspace.textDocuments` is empty at start,
        // so the first open triggers a server didOpen + fresh diagnostic
        // event), but it would silently hang if a future addition pre-opened
        // either URI — `openTextDocument` is idempotent for an already-open
        // doc and wouldn't fire a post-action event.
        await openInEditor(a)
        const diagA = await waitForDiagnostics(a, hasError, FIRST_DIAGS_TIMEOUT_MS, 'project-a')
        await openInEditor(b)
        const diagB = await waitForDiagnostics(b, hasError, DIAGS_TIMEOUT_MS, 'project-b')

        // Both files still produce error diagnostics after B was opened — proves
        // B's server didn't clobber A's. Identity-compare the `LeanClient`s
        // rather than their diagnostic text: two fixtures could render the same
        // message while still being served by independent processes.
        assert.ok(hasError(diagA))
        assert.ok(hasError(diagB))

        const clientProvider = await getClientProvider()
        const clientA = clientProvider.findClient(toExtUriOrError(a))
        const clientB = clientProvider.findClient(toExtUriOrError(b))
        assert.ok(clientA, 'a client should exist for project A')
        assert.ok(clientB, 'a client should exist for project B')
        assert.notStrictEqual(clientA, clientB, 'projects A and B should be served by distinct LeanClient instances')
    })

    it('uses the inner project when a file lives inside a nested project', async () => {
        const outer = Uri.file(path.join(FIXTURES, 'nested-project', 'Main.lean'))
        const inner = Uri.file(path.join(FIXTURES, 'nested-project', 'inner', 'Inner.lean'))

        await openInEditor(outer)
        await waitForDiagnostics(outer, hasError, DIAGS_TIMEOUT_MS, 'nested-outer')
        await openInEditor(inner)
        await waitForDiagnostics(inner, hasError, DIAGS_TIMEOUT_MS, 'nested-inner')

        // Distinct diagnostics don't prove distinct project contexts — a single
        // server handling both files could also produce distinct messages.
        // Look at `LeanClientProvider` directly: one `LeanClient` exists per
        // project folder, so object inequality implies distinct clients
        // (and therefore distinct `lake serve` processes).
        const clientProvider = await getClientProvider()
        const outerClient = clientProvider.findClient(toExtUriOrError(outer))
        const innerClient = clientProvider.findClient(toExtUriOrError(inner))
        assert.ok(outerClient, 'a client should exist for the outer file')
        assert.ok(innerClient, 'a client should exist for the inner file')
        assert.notStrictEqual(
            outerClient,
            innerClient,
            'outer and inner files should be served by distinct LeanClient instances',
        )
    })

    it('launches a server for an untitled Lean document', async () => {
        // The URI of an untitled doc is only known after `openTextDocument`
        // resolves, so the open has to happen before we wait. Each call mints
        // a fresh `untitled:Untitled-N` URI, so leftover state from a prior
        // test is impossible.
        const doc = await workspace.openTextDocument({
            language: 'lean4',
            content: 'example : Nat := "untitled error"\n',
        })
        await showInEditor(doc)
        const diags = await waitForDiagnostics(doc.uri, hasError, DIAGS_TIMEOUT_MS, 'untitled')
        assert.ok(hasError(diags))
    })

    it('launches a server for a detached on-disc file without an enclosing project', async () => {
        const uri = Uri.file(path.join(FIXTURES, 'detached', 'Standalone.lean'))
        await openInEditor(uri)
        const diags = await waitForDiagnostics(uri, hasError, DIAGS_TIMEOUT_MS, 'detached')
        assert.ok(hasError(diags))
    })
})
