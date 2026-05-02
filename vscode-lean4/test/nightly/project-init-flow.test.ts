import * as assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as sinon from 'sinon'
import { Uri, commands, window } from 'vscode'
import { openAndAwaitClient } from '../helpers/client'
import { closeAllEditors } from '../helpers/editors'
import { gitText } from '../helpers/git'
import { hasInfoIncluding, waitForDiagnostics } from '../helpers/lsp'
import { assertPromptFired, withPrompts } from '../helpers/prompts'
import { stubStatefulQuickPick } from '../helpers/quickPicks'
import { afterEachReset } from '../helpers/teardown'
import { makeTestWorkDir, requireIsolatedTestHome } from '../helpers/testHome'
import { CLIENT_READY_MS, FIRST_DIAGS_TIMEOUT_MS } from '../helpers/timeouts'

const INSTALL_TESTS_ENABLED = process.env.LEAN4_TEST_ELAN_INSTALL === '1'

// Mathlib-heavy project-init tests: each one fetches the full mathlib history
// and/or its build-artifact cache, so they only run under the nightly label.
// The non-network `createStandaloneProject` variant lives under the vscode-test-cli label.
describe('Mathlib project initialization (real network)', function () {
    this.timeout(60 * 60_000)

    let workDir: string

    before(function () {
        if (!INSTALL_TESTS_ENABLED) {
            this.skip()
        }
        requireIsolatedTestHome()
        try {
            execFileSync('elan', ['--version'], { env: process.env, stdio: 'ignore' })
        } catch (e) {
            assert.fail(`\`elan\` is not available on PATH: ${(e as Error).message}`)
        }
        workDir = makeTestWorkDir('project-init-')
    })

    afterEach(afterEachReset)

    it('`lean4.project.createMathlibProject` produces a project that depends on Mathlib', async () => {
        const projectFolder = path.join(workDir, 'MathlibProject')

        const saveDialog = sinon.stub(window, 'showSaveDialog').resolves(Uri.file(projectFolder))
        try {
            await withPrompts(
                [],
                async ({ log }) => {
                    await commands.executeCommand('lean4.project.createMathlibProject')

                    assert.strictEqual(saveDialog.callCount, 1)
                    assert.ok(fs.existsSync(projectFolder), `project folder was not created: ${projectFolder}`)

                    const toolchainPath = path.join(projectFolder, 'lean-toolchain')
                    assert.ok(fs.existsSync(toolchainPath), 'lean-toolchain file should exist')

                    // The mathlib template uses a `leanprover/lean4:v4.x.x` toolchain
                    // synced to whatever mathlib currently pins — not the bare
                    // `leanprover-community/mathlib4:lean-toolchain` alias we asked
                    // elan to resolve. Just assert the file is non-empty.
                    const toolchain = fs.readFileSync(toolchainPath, 'utf8').trim()
                    assert.ok(toolchain.length > 0, 'lean-toolchain should not be empty')

                    const lakefileToml = path.join(projectFolder, 'lakefile.toml')
                    const lakefileLean = path.join(projectFolder, 'lakefile.lean')
                    const lakefilePath = fs.existsSync(lakefileToml)
                        ? lakefileToml
                        : fs.existsSync(lakefileLean)
                          ? lakefileLean
                          : undefined
                    assert.ok(lakefilePath, 'lakefile.toml or lakefile.lean should exist')
                    const lakefile = fs.readFileSync(lakefilePath, 'utf8')
                    assert.match(lakefile, /mathlib/i, 'lakefile should declare a mathlib dependency')

                    assert.ok(
                        fs.existsSync(path.join(projectFolder, 'lake-manifest.json')),
                        'lake-manifest.json should exist (dependencies were resolved)',
                    )
                    assert.ok(
                        fs.existsSync(path.join(projectFolder, '.lake', 'packages', 'mathlib')),
                        'mathlib package should have been fetched into .lake/packages/',
                    )

                    assert.ok(
                        fs.existsSync(path.join(projectFolder, '.git')),
                        '.git directory should exist (initial commit was made)',
                    )
                    assert.match(gitText(projectFolder, 'log', '--oneline'), /Initial commit/)

                    assertPromptFired(log, {
                        messagePattern: /Project initialized\. Open new project folder/,
                        dismissed: true,
                    })

                    // Files-on-disk assertions don't prove the project actually
                    // elaborates. Append `#eval "<sentinel>"` to the math
                    // template's `<projectName>/Basic.lean` (which has
                    // `import Mathlib`) and wait for the info-level diagnostic
                    // carrying the sentinel — confirms Mathlib is reachable and
                    // the LSP is functional end-to-end.
                    const basicLean = path.join(projectFolder, 'MathlibProject', 'Basic.lean')
                    assert.ok(fs.existsSync(basicLean), `expected ${basicLean} to exist after lake init`)
                    const sentinel = 'mathlib-eval-ok'
                    fs.appendFileSync(basicLean, `\n#eval "${sentinel}"\n`)
                    const basicUri = Uri.file(basicLean)
                    try {
                        await openAndAwaitClient(basicUri, CLIENT_READY_MS)
                        await waitForDiagnostics(
                            basicUri,
                            hasInfoIncluding(sentinel),
                            FIRST_DIAGS_TIMEOUT_MS,
                            'MathlibProject #eval output',
                        )
                    } finally {
                        await closeAllEditors()
                    }
                },
                { dismissRemaining: true },
            )
        } finally {
            saveDialog.restore()
        }
    })

    it('`lean4.project.clone` downloads the Mathlib preset into a working project', async () => {
        const projectFolder = path.join(workDir, 'ClonedMathlib')

        // The clone command uses the stateful `createQuickPick` API, not the
        // one-shot `showQuickPick` — stub it accordingly.
        const { stub: createQuickPick, accepted } = stubStatefulQuickPick('Mathlib')
        const saveDialog = sinon.stub(window, 'showSaveDialog').resolves(Uri.file(projectFolder))
        try {
            await withPrompts(
                [],
                async ({ log }) => {
                    await commands.executeCommand('lean4.project.clone')
                    await accepted

                    assert.strictEqual(createQuickPick.callCount, 1)
                    assert.strictEqual(saveDialog.callCount, 1)
                    assert.ok(fs.existsSync(projectFolder), `project folder was not created: ${projectFolder}`)

                    assert.ok(
                        fs.existsSync(path.join(projectFolder, '.git')),
                        '.git directory should exist (git clone succeeded)',
                    )
                    assert.ok(
                        fs.existsSync(path.join(projectFolder, 'lean-toolchain')),
                        'lean-toolchain file should exist (this is a Lean project)',
                    )
                    assert.ok(
                        fs.existsSync(path.join(projectFolder, 'lakefile.lean')) ||
                            fs.existsSync(path.join(projectFolder, 'lakefile.toml')),
                        'mathlib lakefile should exist',
                    )
                    assert.ok(
                        fs.existsSync(path.join(projectFolder, 'lake-manifest.json')),
                        'lake-manifest.json should exist (resolveDeps ran)',
                    )
                    assert.ok(
                        fs.existsSync(path.join(projectFolder, 'Mathlib')),
                        'Mathlib/ source directory should exist after cloning',
                    )

                    const remote = gitText(projectFolder, 'config', '--get', 'remote.origin.url').trim()
                    assert.match(remote, /leanprover-community\/mathlib4/, 'remote should point at mathlib4')

                    assertPromptFired(log, {
                        messagePattern: /Project initialized\. Open new project folder/,
                        dismissed: true,
                    })
                },
                { dismissRemaining: true },
            )
        } finally {
            saveDialog.restore()
            createQuickPick.restore()
        }
    })

    // Stands on its own: set up a fresh mathlib project via `lake new`, then
    // exercise the fetchCache command. Mathlib's `cache` tool reads from a
    // content-addressable store under the user cache dir, so once one of the
    // earlier tests has populated it, this second `lake exe cache get` is
    // effectively a metadata round-trip (the git clone of mathlib is the
    // dominant cost, which is unavoidable for a second project).
    it('`lean4.project.fetchCache` succeeds on a freshly scaffolded Mathlib project', async () => {
        const projectName = 'FetchCacheProject'
        const projectFolder = path.join(workDir, projectName)

        // `lake new <name>` rejects absolute paths ("illegal package name") —
        // pass the basename and run from the parent so the project lands at
        // the desired absolute path. `stdio: 'pipe'` so a failure surfaces
        // with captured stderr/stdout in the rethrown error rather than an
        // opaque `Command failed: lake new …`.
        try {
            execFileSync('lake', ['new', projectName, 'math'], {
                cwd: workDir,
                env: process.env,
                stdio: 'pipe',
            })
        } catch (e) {
            const err = e as { message: string; stderr?: Buffer; stdout?: Buffer }
            const stderr = err.stderr?.toString().trim() ?? ''
            const stdout = err.stdout?.toString().trim() ?? ''
            const detail =
                [stderr && `stderr:\n${stderr}`, stdout && `stdout:\n${stdout}`].filter(Boolean).join('\n--\n') ||
                '(no output captured)'
            throw new Error(`\`lake new ${projectName} math\` (cwd ${workDir}) failed: ${err.message}\n${detail}`)
        }
        // No `lake update` here: `lean4.project.fetchCache` eventually runs
        // `lake exe cache get`, and modern lake auto-resolves deps on
        // `lake exe`. Letting the extension trigger the resolve matches the
        // real fresh-user flow (scaffold → fetchCache) and avoids
        // duplicating work the command already does.

        // `lake new X math` creates a library entry named after the project
        // (e.g. `FetchCacheProject.lean`), not `Main.lean`. Find any top-level
        // .lean file in the project to open — we only need something that
        // spawns a Lean client for this folder.
        const leanEntryFile = fs
            .readdirSync(projectFolder)
            .find(name => name.endsWith('.lean') && !name.startsWith('lakefile'))
        assert.ok(
            leanEntryFile,
            `expected a top-level .lean file in ${projectFolder}; got: ${fs.readdirSync(projectFolder).join(', ')}`,
        )
        const mainUri = Uri.file(path.join(projectFolder, leanEntryFile))

        await openAndAwaitClient(mainUri, CLIENT_READY_MS)

        try {
            await withPrompts(
                [],
                async ({ log }) => {
                    await commands.executeCommand('lean4.project.fetchCache')
                    assertPromptFired(log, {
                        kind: 'info',
                        messagePattern: /Mathlib build artifact cache fetched successfully/,
                    })
                },
                { dismissRemaining: true },
            )
        } finally {
            await closeAllEditors()
        }
    })
})
