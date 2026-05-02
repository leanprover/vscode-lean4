import * as assert from 'node:assert'
import * as path from 'node:path'
import { Uri, commands, workspace } from 'vscode'
import { activateExtension } from '../helpers/activation'
import { openInEditor, showInEditor } from '../helpers/editors'
import { FIXTURES, scaffoldFromFixture } from '../helpers/fixtures'
import { createMockToolchain } from '../helpers/mockToolchain'
import { waitForPrompt, withPrompts } from '../helpers/prompts'
import { afterEachReset } from '../helpers/teardown'

const PROMPT_TIMEOUT_MS = 2 * 60_000

describe('Setup preconditions', function () {
    this.timeout(PROMPT_TIMEOUT_MS + 60_000)

    before(activateExtension)

    afterEach(afterEachReset)

    it('`lean4.troubleshooting.showSetupInformation` produces a diagnostic report', async () => {
        // Assert the structural shape of the report (info-level, multiple
        // bold-labelled sections) rather than specific labels, which churn
        // with cosmetic edits.
        const MIN_SECTIONS = 3
        await withPrompts([], async ({ log }) => {
            await commands.executeCommand('lean4.troubleshooting.showSetupInformation')

            const match = await waitForPrompt(
                log,
                p => p.kind === 'info' && (p.message.match(/\*\*[^*\n]+\*\*/g) ?? []).length >= MIN_SECTIONS,
                PROMPT_TIMEOUT_MS,
                `setup information report (expected ≥${MIN_SECTIONS} bold-labelled sections)`,
            )
            const sections = match.message.match(/\*\*[^*\n]+\*\*/g) ?? []
            assert.ok(
                sections.length >= MIN_SECTIONS,
                `expected ≥${MIN_SECTIONS} **...** sections; got ${sections.length}: ${sections.join(' | ')}`,
            )
        }, { dismissRemaining: true })
    })

    it('warns about restricted single-file mode when opening an untitled Lean document', async () => {
        // Untitled Lean docs have no enclosing folder, so the project diagnoser
        // sees `cwdUri === undefined` and emits `SingleFile`. The
        // user-visible `singleFileWarningMessage` is uniquely identified by
        // its "restricted single file mode" prefix.
        await withPrompts([], async ({ log }) => {
            const doc = await workspace.openTextDocument({ language: 'lean4' })
            await showInEditor(doc)

            await waitForPrompt(
                log,
                p => p.kind === 'warn' && p.message.includes('restricted single file mode'),
                PROMPT_TIMEOUT_MS,
                'single-file-mode warning',
            )
        }, { dismissRemaining: true })
    })

    it('warns when opening a detached Lean file with no enclosing project', async () => {
        // The `detached` fixture has no `lean-toolchain`, no `lakefile.*`,
        // and no ancestor project. The diagnoser emits `MissingLeanToolchain`
        // (without a parent-project folder) and the warning is uniquely
        // identified by its "Opened folder does not contain" prefix.
        await withPrompts([], async ({ log }) => {
            const uri = Uri.file(path.join(FIXTURES, 'detached', 'Standalone.lean'))
            await openInEditor(uri)

            await waitForPrompt(
                log,
                p => p.kind === 'warn' && p.message.includes('Opened folder does not contain'),
                PROMPT_TIMEOUT_MS,
                'missing-lean-toolchain warning',
            )
        }, { dismissRemaining: true })
    })

    it('errors when opening a project folder that has a lakefile but no lean-toolchain', async () => {
        // `clientProvider.ensureClient` short-circuits with an error before
        // even attempting to launch a server when the project root has a
        // lakefile but no `lean-toolchain` (kind: 'LakefileWithoutToolchain').
        await withPrompts([], async ({ log }) => {
            const uri = Uri.file(path.join(FIXTURES, 'lakefile-no-toolchain', 'Main.lean'))
            await openInEditor(uri)

            await waitForPrompt(
                log,
                p =>
                    p.kind === 'error' &&
                    p.message.includes("has a Lakefile, but lacks a 'lean-toolchain' file"),
                PROMPT_TIMEOUT_MS,
                'lakefile-without-toolchain error',
            )
        }, { dismissRemaining: true })
    })

    // Drive the lean-version diagnostics with a mock toolchain whose `bin/lean`
    // is a shell script printing a chosen version string. Real Lean 3 / ancient
    // Lean 4 toolchains exist, but downloading them on every test run isn't
    // worth the wall-clock cost — and elan happily resolves a `link`-ed fake
    // toolchain by name from `lean-toolchain`. The toolchain name is hardcoded
    // in each fixture's `lean-toolchain` and must match the `createMockToolchain`
    // call below.
    it('errors when the project pins a Lean 3 toolchain', async () => {
        createMockToolchain('mock-lean3', { leanVersion: 'Lean (version 3.51.1, commit deadbeef, Release)' })
        const projectDir = scaffoldFromFixture('mock-lean3-project', 'lean3-')
        await withPrompts([], async ({ log }) => {
            await openInEditor(Uri.file(path.join(projectDir, 'Main.lean')))
            await waitForPrompt(
                log,
                p => p.kind === 'error' && p.message.includes('is using Lean 3'),
                PROMPT_TIMEOUT_MS,
                'Lean 3 project error',
            )
        }, { dismissRemaining: true })
    })

    it('warns when the project pins a pre-4.0 Lean 4 toolchain', async () => {
        createMockToolchain('mock-ancient-lean4', {
            leanVersion: 'Lean (version 4.0.0-rc1, commit deadbeef, Release)',
        })
        const projectDir = scaffoldFromFixture('mock-ancient-lean4-project', 'ancient-')
        await withPrompts([], async ({ log }) => {
            await openInEditor(Uri.file(path.join(projectDir, 'Main.lean')))
            await waitForPrompt(
                log,
                p => p.kind === 'warn' && p.message.includes('Pre-stable Lean 4 versions'),
                PROMPT_TIMEOUT_MS,
                'ancient Lean 4 warning',
            )
        }, { dismissRemaining: true })
    })
})
