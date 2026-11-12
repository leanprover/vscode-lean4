import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Diagnostic, Uri, commands, workspace } from 'vscode'
import { clientForFolder } from '../helpers/client'
import { openInEditor } from '../helpers/editors'
import { hasError, waitForDiagnostics } from '../helpers/lsp'
import { dumpStateIfFailed } from '../helpers/teardown'
import { makeTestWorkDir } from '../helpers/testHome'
import { DIAGS_TIMEOUT_MS, RESTART_DIAGS_TIMEOUT_MS, pollFor, withTimeout } from '../helpers/timeouts'

function noisyProject(pause: boolean): { dir: string; uri: Uri; marker: string } {
    const dir = makeTestWorkDir('noisy-lake-startup-')
    const dep = path.join(dir, 'noisy')
    fs.mkdirSync(dep)
    fs.writeFileSync(path.join(dir, 'lean-toolchain'), process.env.LEAN4_TEST_TOOLCHAIN ?? 'leanprover/lean4:stable')
    fs.writeFileSync(
        path.join(dir, 'lakefile.lean'),
        'import Lake\nopen Lake DSL\npackage startup\nrequire noisy from "noisy"\n',
    )
    const marker = path.join(dir, 'hook-started')
    fs.writeFileSync(
        path.join(dep, 'lakefile.lean'),
        'import Lake\nopen Lake DSL\npackage noisy\npost_update _pkg do\n' +
            '  IO.println "Current branch: HEAD"\n  IO.print "Decompressing 8689 files"\n' +
            '  IO.print "HTTP/1.1 200 OK\\r\\nContent-Length: 999999\\r\\n\\r\\nHook progress"\n' +
            `  IO.FS.writeFile ${JSON.stringify(marker)} "started"\n` +
            (pause ? '  IO.sleep 60000\n' : ''),
    )
    const file = path.join(dir, 'Main.lean')
    fs.writeFileSync(file, '#eval (do return s!"elaboration {← IO.monoNanosNow}" : IO String)\n')
    return { dir, uri: Uri.file(file), marker }
}

// `Restart.lean` shows a new number for each elaboration (`IO.monoNanosNow`).
// Thus a test can see that a restart elaborated the file again. The
// diagnostics alone cannot show this: the extension can merge the empty
// diagnostics of the restart with the new diagnostics.
function elaborationId(diags: Diagnostic[]): string | undefined {
    for (const d of diags) {
        const match = /elaboration (\d+)/.exec(d.message)
        if (match) return match[1]
    }
    return undefined
}

describe('Language server — launch and restart', function () {
    this.timeout(DIAGS_TIMEOUT_MS + RESTART_DIAGS_TIMEOUT_MS + 60_000)

    let main: Uri
    let restart: Uri

    before(async () => {
        const folder = workspace.workspaceFolders?.[0]
        assert.ok(folder, 'a workspace folder must be open')
        main = Uri.file(path.join(folder.uri.fsPath, 'Main.lean'))
        restart = Uri.file(path.join(folder.uri.fsPath, 'Restart.lean'))
    })

    // Not `afterEachReset`, which closes the editors: if the next test opens
    // the file again, the server elaborates it again. That elaboration can
    // still run when the next test restarts, and look like the restart.
    afterEach(function () {
        return dumpStateIfFailed(this)
    })

    it('launches the server and produces an error diagnostic on the fixture', async () => {
        await openInEditor(main)
        const diags = await waitForDiagnostics(main, hasError, DIAGS_TIMEOUT_MS, 'initial')
        assert.ok(hasError(diags))
    })

    // A restart that does nothing fails these tests: only a new elaboration
    // gives a new number.
    for (const command of ['lean4.restartFile', 'lean4.restartServer']) {
        it(`elaborates the current file again after \`${command}\``, async () => {
            await openInEditor(restart)
            const before = elaborationId(
                await waitForDiagnostics(
                    restart,
                    d => elaborationId(d) !== undefined,
                    DIAGS_TIMEOUT_MS,
                    `before ${command}`,
                ),
            )
            await commands.executeCommand(command)
            await waitForDiagnostics(
                restart,
                d => {
                    const id = elaborationId(d)
                    return id !== undefined && id !== before
                },
                RESTART_DIAGS_TIMEOUT_MS,
                `after ${command}`,
            )
        })
    }

    it('starts a cold Lake project with noisy hooks and restarts it warm', async () => {
        const { dir, uri, marker } = noisyProject(false)
        await openInEditor(uri)
        const before = elaborationId(
            await waitForDiagnostics(uri, d => elaborationId(d) !== undefined, DIAGS_TIMEOUT_MS, 'cold noisy startup'),
        )
        assert.ok(fs.existsSync(marker), 'the cold startup must run the dependency hook')
        const client = await clientForFolder(dir)
        assert.ok(client)
        await client.restart()
        await waitForDiagnostics(
            uri,
            d => elaborationId(d) !== undefined && elaborationId(d) !== before,
            RESTART_DIAGS_TIMEOUT_MS,
            'warm noisy-project restart',
        )
    })

    it('stops during dependency setup and retries without reloading VS Code', async () => {
        const { dir, uri, marker } = noisyProject(true)
        await openInEditor(uri)
        await pollFor(() => fs.existsSync(marker) || undefined, DIAGS_TIMEOUT_MS, 'the dependency hook to start')
        const client = await clientForFolder(dir)
        assert.ok(client)
        assert.ok(client.isRestarting())
        await withTimeout(
            Promise.resolve(commands.executeCommand('lean4.stopServer')),
            15_000,
            'Stop during dependency setup',
        )
        assert.ok(!client.isRestarting(), 'awaited Stop must allow an immediate retry')
        assert.ok(!client.isRunning())
        // Lake wrote its manifest before starting the hook, so the retry is warm.
        await client.restart()
        await waitForDiagnostics(
            uri,
            d => elaborationId(d) !== undefined,
            RESTART_DIAGS_TIMEOUT_MS,
            'restart after cancelled dependency setup',
        )
    })

    it('can stop before the startup process has been created', async () => {
        const { dir, uri } = noisyProject(false)
        await openInEditor(uri)
        const client = await pollFor(() => clientForFolder(dir), DIAGS_TIMEOUT_MS, 'the new project client')
        await client.stop()
        // Force Stop before transport creation; polling alone cannot guarantee
        // that ordering on a fast machine.
        const startup = client as unknown as {
            determineToolchainOverride: (...args: unknown[]) => Promise<unknown>
        }
        const original = startup.determineToolchainOverride
        let release!: () => void
        let entered!: () => void
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        const reached = new Promise<void>(resolve => {
            entered = resolve
        })
        startup.determineToolchainOverride = async (...args) => {
            entered()
            await gate
            return original.apply(client, args)
        }
        const restarting = client.restart()
        try {
            await withTimeout(reached, DIAGS_TIMEOUT_MS, 'the preparation gate')
            const stopping = client.stop()
            release()
            await stopping
            await restarting
        } finally {
            release()
            startup.determineToolchainOverride = original
            await restarting
        }
        assert.ok(!client.isRunning())
        assert.ok(!client.isRestarting())
        assert.ok(!client.isStarted(), 'cancelled preparation must not create a client')
        await client.restart()
        await waitForDiagnostics(
            uri,
            d => elaborationId(d) !== undefined,
            RESTART_DIAGS_TIMEOUT_MS,
            'restart after early Stop',
        )
    })
})
