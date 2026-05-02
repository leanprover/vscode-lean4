import * as assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { commands } from 'vscode'
import { ElanUnresolvedToolchain, elanDumpStateWithoutNet } from '../../src/utils/elan'
import { withPrompts } from '../helpers/prompts'
import { afterEachReset } from '../helpers/teardown'
import { requireIsolatedTestHome } from '../helpers/testHome'

const INSTALL_TESTS_ENABLED = process.env.LEAN4_TEST_ELAN_INSTALL === '1'

// `elanDumpStateWithoutNet` (and any other elan invocation that goes through
// `batchExecute('elan', …)`) resolves the binary via `process.env.PATH`. The
// elan installer drops elan at `<ELAN_HOME>/bin/elan`, but that directory
// isn't on the test process's PATH yet — the install script modifies the
// user's shell rc files, not the running env. Prepend the bin dir at module
// load so post-install elan calls resolve the just-installed binary rather
// than failing with ENOENT (no system elan exists on a cold-runner CI).
//
// This mutation persists for the entire `nightly` VS Code instance: each
// label runs in its own instance per `.vscode-test.mjs`, but mocha loads
// every `*.test.js` for that label into the same process. Side effect:
// the other nightly files (`project-init-flow.test.ts`,
// `toolchain-updates.test.ts`) inherit the mutated PATH too. Today they
// load alphabetically after this one, so the prepend is in place by the
// time their `before` hooks run. Harmless on non-cold runners where elan
// was already on PATH at process start — the same dir gets prepended
// twice, which is a no-op for resolution.
if (process.env.ELAN_HOME) {
    process.env.PATH = `${path.join(process.env.ELAN_HOME, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`
}

describe('Elan installation (real network)', function () {
    this.timeout(10 * 60_000)

    let elanHome: string

    before(function () {
        if (!INSTALL_TESTS_ENABLED) {
            this.skip()
        } else {
            // Safety: we are about to wipe ELAN_HOME. Require the isolation marker from .vscode-test.mjs.
            ;({ elanHome } = requireIsolatedTestHome({ requireElanHome: true }))
            fs.rmSync(elanHome, { recursive: true, force: true })
        }
    })

    afterEach(afterEachReset)

    it('installs Elan when the user accepts the install prompt', async () => {
        // Key each answer on the prompt's message text, then pick a matching
        // button label. Label-only matching could consume a button on a
        // different prompt if the sequence ever changes. Match on `Elan`
        // alone for the install-Elan prompt — the message wording is "install
        // Lean's version manager Elan", with `Elan` at the end, so anything
        // tighter (e.g. `/Install Elan/i`) silently misses and the prompt
        // gets dismissed instead of accepted.
        const answer = (re: RegExp, label: RegExp) => (message: string, items: string[]) =>
            re.test(message) ? items.find(i => label.test(i)) : undefined
        await withPrompts(
            [answer(/version manager Elan/i, /Install/i), answer(/toolchain/i, /Install/i)],
            async ({ log }) => {
                await commands.executeCommand('lean4.setup.installElan')
                const elanBin = process.platform === 'win32'
                    ? path.join(elanHome, 'bin', 'elan.exe')
                    : path.join(elanHome, 'bin', 'elan')
                assert.ok(fs.existsSync(elanBin), `elan binary should exist at ${elanBin} after install`)
                // File-existence alone passes for corrupt or wrong-architecture
                // binaries. Run `elan --version` to assert the binary is
                // actually executable; failure here would print elan's own
                // error (e.g. ELF/Mach-O incompatibility) into the rethrown
                // exception via stderr capture.
                let version: string
                try {
                    version = execFileSync(elanBin, ['--version'], {
                        env: { ...process.env, ELAN_HOME: elanHome },
                        stdio: ['ignore', 'pipe', 'pipe'],
                    })
                        .toString()
                        .trim()
                } catch (e) {
                    const err = e as Error & { stderr?: Buffer; stdout?: Buffer }
                    throw new Error(
                        `installed elan failed to report --version: ${err.message}\n` +
                            `stderr: ${err.stderr?.toString() ?? ''}\nstdout: ${err.stdout?.toString() ?? ''}`,
                    )
                }
                assert.ok(/^elan\s/.test(version), `expected \`elan --version\` to start with "elan "; got ${JSON.stringify(version)}`)
                // The install flow should also have set `leanprover/lean4:stable`
                // as the default toolchain — both prompts are answered "Install"
                // (Elan + toolchain), so a missing default would mean the second
                // step silently no-op'd. Query elan via `elanDumpStateWithoutNet`
                // (the same code path production uses) rather than parsing
                // `settings.toml` by hand. PATH was already extended at module
                // load to include `<ELAN_HOME>/bin/` so the just-installed
                // binary is found here.
                const dumpState = await elanDumpStateWithoutNet(undefined)
                assert.strictEqual(
                    dumpState.kind,
                    'Success',
                    `elan dump-state should succeed; got ${dumpState.kind}` +
                        (dumpState.kind === 'ExecutionError' ? `: ${dumpState.message}` : ''),
                )
                assert.ok(dumpState.kind === 'Success')
                const defaultToolchain = dumpState.state.toolchains.default
                assert.ok(defaultToolchain, 'default toolchain should be set after install')
                assert.strictEqual(
                    ElanUnresolvedToolchain.toolchainName(defaultToolchain.unresolved),
                    'leanprover/lean4:stable',
                    'default toolchain should be leanprover/lean4:stable after the install flow',
                )
                assert.ok(
                    log.some(e => /Elan/i.test(e.message)),
                    'user was prompted about Elan',
                )
            },
            { dismissRemaining: true },
        )
    })
})
