import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Uri, commands } from 'vscode'
import { activateExtension } from '../helpers/activation'
import { openAndAwaitClient } from '../helpers/client'
import { withOpenDialog, withSaveDialog } from '../helpers/dialogs'
import { closeAllEditors } from '../helpers/editors'
import { FIXTURES } from '../helpers/fixtures'
import { gitText } from '../helpers/git'
import { hasInfoIncluding, waitForDiagnostics } from '../helpers/lsp'
import { assertPromptFired, withPrompts } from '../helpers/prompts'
import { afterEachReset } from '../helpers/teardown'
import { makeTestWorkDir } from '../helpers/testHome'
import { CLIENT_READY_MS, FIRST_DIAGS_TIMEOUT_MS } from '../helpers/timeouts'

// Non-mathlib project-init behaviours. The mathlib variants
// (`createMathlibProject`, `clone`) sit under the nightly label because they
// hit the network hard; `createStandaloneProject` is cheap enough to run on
// every PR.
describe('Project initialization commands', function () {
    // Generous: the standalone test runs `lake init` + `lake update` + a build
    // + an `#eval` round-trip. The LSP first-launch budget alone is 10 min.
    this.timeout(FIRST_DIAGS_TIMEOUT_MS + 5 * 60_000)

    before(activateExtension)

    afterEach(afterEachReset)

    it('`lean4.project.createStandaloneProject` produces a buildable, committed project', async () => {
        const workDir = makeTestWorkDir('standalone-project-')
        const projectFolder = path.join(workDir, 'StandaloneProject')

        await withSaveDialog(Uri.file(projectFolder), async ({ log: saveLog }) => {
            // The precondition checks run with `toolchainUpdateMode:
            // 'UpdateAutomatically'` and install stable silently if needed.
            // `dismissRemaining` drops the post-init "Open new project folder"
            // prompt; opening it would tear down the extension host and break
            // later tests.
            await withPrompts([], async ({ log }) => {
                await commands.executeCommand('lean4.project.createStandaloneProject')

                assert.strictEqual(saveLog.length, 1)
                assert.ok(fs.existsSync(projectFolder), `project folder was not created: ${projectFolder}`)
                assert.ok(
                    fs.existsSync(path.join(projectFolder, 'lean-toolchain')),
                    'lean-toolchain file should exist',
                )
                const hasLakefile =
                    fs.existsSync(path.join(projectFolder, 'lakefile.toml')) ||
                    fs.existsSync(path.join(projectFolder, 'lakefile.lean'))
                assert.ok(hasLakefile, 'lakefile.toml or lakefile.lean should exist')
                assert.ok(
                    fs.existsSync(path.join(projectFolder, '.git')),
                    '.git directory should exist (initial commit was made)',
                )

                assert.match(
                    gitText(projectFolder, 'log', '--oneline'),
                    /Initial commit/,
                    'initial commit should be present in git log',
                )

                assertPromptFired(log, {
                    messagePattern: /Project initialized\. Open new project folder/,
                    dismissed: true,
                })

                // Files-on-disk assertions don't prove the project actually
                // elaborates. Append `#eval "<sentinel>"` to the default
                // template's `<projectName>/Basic.lean` (`def hello := …`)
                // and wait for the info-level diagnostic carrying the sentinel.
                const basicLean = path.join(projectFolder, 'StandaloneProject', 'Basic.lean')
                assert.ok(fs.existsSync(basicLean), `expected ${basicLean} to exist after lake init`)
                const sentinel = 'standalone-eval-ok'
                fs.appendFileSync(basicLean, `\n#eval "${sentinel}"\n`)
                const basicUri = Uri.file(basicLean)
                try {
                    await openAndAwaitClient(basicUri, CLIENT_READY_MS)
                    await waitForDiagnostics(
                        basicUri,
                        hasInfoIncluding(sentinel),
                        FIRST_DIAGS_TIMEOUT_MS,
                        'StandaloneProject #eval output',
                    )
                } finally {
                    await closeAllEditors()
                }
            }, { dismissRemaining: true })
        })
    })

    it('`lean4.project.open` reports an error when the selected folder is not a Lean 4 project', async () => {
        // The `detached` fixture has no `lean-toolchain`; neither does its parent.
        const detachedDir = Uri.file(path.join(FIXTURES, 'detached'))
        await withOpenDialog([detachedDir], async ({ log: openLog }) => {
            await withPrompts([], async ({ log }) => {
                await commands.executeCommand('lean4.project.open')
                assert.strictEqual(openLog.length, 1)
                assertPromptFired(log, {
                    kind: 'error',
                    messagePattern: /not a valid Lean 4 project folder/,
                })
            }, { dismissRemaining: true })
        })
    })
})
