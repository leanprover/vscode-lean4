import * as assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { commands } from 'vscode'
import { ElanUnresolvedToolchain, elanDumpStateWithoutNet, elanSetDefaultToolchain } from '../../src/utils/elan'
import { assertPromptFired, withPrompts } from '../helpers/prompts'
import { withQuickPicks } from '../helpers/quickPicks'
import { afterEachReset } from '../helpers/teardown'
import { requireIsolatedTestHome } from '../helpers/testHome'
import { pollFor } from '../helpers/timeouts'

const ELAN_HOME = process.env.ELAN_HOME ?? ''

// Returns the configured default toolchain via `elan dump-state --no-net` —
// the same code path production uses (`utils/elan.ts:elanDumpStateWithoutNet`),
// so the test stays in sync with what the extension would observe instead of
// parsing `settings.toml` by hand and risking schema drift.
async function currentDefault(): Promise<string | undefined> {
    const dumpState = await elanDumpStateWithoutNet(undefined)
    if (dumpState.kind !== 'Success') {
        const detail = dumpState.kind === 'ExecutionError' ? `: ${dumpState.message}` : ''
        throw new Error(`elan dump-state should succeed; got ${dumpState.kind}${detail}`)
    }
    const def = dumpState.state.toolchains.default
    return def ? ElanUnresolvedToolchain.toolchainName(def.unresolved) : undefined
}

describe('Version management commands', function () {
    this.timeout(60_000)

    // Tests in this suite mutate `~/.elan/settings.toml` via `elan default`.
    // The vscode-test-cli runner shares one elan home across every per-file
    // VS Code instance in a run, so without restoration the mutation would
    // leak into every subsequent test file (and silently flip the run-wide
    // default — e.g. away from `:nightly` in the nightly-Lean CI variant).
    // Capture the pre-suite default in `before` and put it back in
    // `afterEach` so each test starts from the same clean state, regardless
    // of how many tests we add to this suite later.
    let originalDefault: string | undefined

    before(async function () {
        // Safety marker: tests in this suite mutate elan state via `elan default`.
        requireIsolatedTestHome({ requireElanHome: true })
        try {
            execFileSync('elan', ['--version'], { env: process.env, stdio: 'ignore' })
        } catch (e) {
            assert.fail(`\`elan\` is not available on PATH: ${(e as Error).message}`)
        }
        originalDefault = await currentDefault()
    })

    afterEach(afterEachReset)
    afterEach(async function () {
        if (originalDefault === undefined) {
            // Nothing to restore. In practice elan-init always sets a default,
            // so this branch only triggers in an exotic test home where no
            // default was configured before the suite started — leave elan
            // alone in that case rather than picking one arbitrarily.
            return
        }
        const r = await elanSetDefaultToolchain(undefined, originalDefault)
        if (r.kind !== 'Success') {
            const detail = r.kind === 'Error' ? `: ${r.message}` : ''
            throw new Error(`failed to restore pre-test default toolchain ${originalDefault} (${r.kind})${detail}`)
        }
    })

    it('`lean4.setup.selectDefaultToolchain` sets the chosen toolchain as default when confirmed', async () => {
        // Seed a distinct pre-state. `stable` is already the default from
        // elan-init, so without this the post-assertion would pass even if the
        // command were a no-op. Go through the production `elanSetDefaultToolchain`
        // helper so elan writes `settings.toml` in whatever schema it currently
        // expects; hand-rolling TOML here would trip elan's own parser when
        // the command-under-test runs.
        const seedResult = await elanSetDefaultToolchain(undefined, 'leanprover/lean4:v4.0.0')
        if (seedResult.kind !== 'Success') {
            const detail = seedResult.kind === 'Error' ? seedResult.message : ''
            assert.fail(
                `failed to seed default via \`elan default\` (${seedResult.kind}): ${detail}\n` +
                    `settings.toml: ${fs.existsSync(path.join(ELAN_HOME, 'settings.toml')) ? fs.readFileSync(path.join(ELAN_HOME, 'settings.toml'), 'utf8') : '<missing>'}`,
            )
        }
        assert.strictEqual(
            await currentDefault(),
            'leanprover/lean4:v4.0.0',
            'precondition: seeded default is in place',
        )

        await withQuickPicks([/Always use most recent stable version/], async picks => {
            await withPrompts(['Proceed'], async ({ log }) => {
                await commands.executeCommand('lean4.setup.selectDefaultToolchain')
                assert.strictEqual(picks.log.length, 1)
                assertPromptFired(log, { messagePattern: /Do you wish to proceed/, chose: 'Proceed' })
                // Poll rather than assert synchronously. The production
                // command awaits the elan-write today, but a future refactor
                // that fire-and-forgets the `settings.toml` write would make
                // a synchronous assertion race the disk and surface as a
                // confusing "still set to v4.0.0" flake. The poll documents
                // the expectation and absorbs the race; 5s is a generous
                // floor for an `elan default` call that's already happened.
                let observed: string | undefined
                await pollFor(
                    async () => {
                        observed = await currentDefault()
                        return observed === 'leanprover/lean4:stable' ? observed : undefined
                    },
                    5_000,
                    () =>
                        'default toolchain to become leanprover/lean4:stable; ' +
                        `last observed: ${JSON.stringify(observed)}`,
                )
            }, { dismissRemaining: true })
        })
    })
})
