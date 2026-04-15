import * as assert from 'node:assert'
import { ExecutionExitCode } from '../../src/utils/batch'
import {
    elanDumpStateWithoutNet,
    elanInstallToolchain,
    elanInstalledToolchains,
    elanSetDefaultToolchain,
    elanUninstallToolchains,
} from '../../src/utils/elan'
import { LeanCommandRunner } from '../../src/utils/leanCmdRunner'
import { activateExtension } from '../helpers/activation'
import { withPrompts } from '../helpers/prompts'
import { afterEachReset } from '../helpers/teardown'
import { requireIsolatedTestHome } from '../helpers/testHome'

const INSTALL_TESTS_ENABLED = process.env.LEAN4_TEST_ELAN_INSTALL === '1'

// A distant, cheap stable release we install purely to give elan an older
// predecessor to fall back to when we uninstall the current `:stable`
// resolution. Must be strictly older than whatever `:stable` resolves to —
// when `OLD_STABLE === current`, seedDivergence uninstalls them as the same
// toolchain and `cachedStable()` then returns `undefined` instead of the
// fallback we want.
//
// Subtle failure mode (observed 2026-04-30): elan's `dump-state --no-net`
// `cached` field for a channel is *not* the network-resolved version. It's
// a fallback heuristic that walks installed `leanprover/lean4:*` toolchains
// and picks the most recent **non-pre-release** one. Normally that lands on
// the actual stable resolution. But if `:stable` is itself tagged at a
// pre-release (e.g. an accidental `v4.30.0-rc2` release), elan's heuristic
// skips it and falls back to OLD_STABLE — making `current === OLD_STABLE`
// in this test no matter what version OLD_STABLE is set to. The seed flow
// then uninstalls OLD_STABLE as `current`, leaves no toolchain installed,
// and the assertion fails. Recovery: wait for the upstream tag to be
// corrected; the design isn't robust to `:stable` being a pre-release.
const OLD_STABLE = 'leanprover/lean4:v4.20.0'
const STABLE_CHANNEL = 'leanprover/lean4:stable'
const UPDATE_PROMPT_RE = /Do you wish to install the new Lean version/

async function cachedStable(): Promise<string | undefined> {
    const r = await elanDumpStateWithoutNet(undefined, STABLE_CHANNEL)
    if (r.kind !== 'Success') return undefined
    return r.state.toolchains.resolvedActive?.cachedToolchain
}

// Brings elan into a state where the `stable` channel's current resolution is
// uninstalled, so `elan dump-state` reports `cached ≠ live` — the divergence
// the update-prompt flow reacts to. Relies on elan dropping `cached` back to
// the most recent *installed* predecessor of the channel when we uninstall
// the newer resolution, and asserts that the predecessor is OLD_STABLE
// specifically so the downstream assertions run against a known fixture.
//
// ELAN_HOME is shared across CI runs when `LEAN4_TEST_HOME_OVERRIDE` is set,
// so residual toolchains from earlier runs (e.g. the last run's `stable`
// resolution, now superseded by a new point release) can sit in the cache.
// To keep the fallback deterministic, prune any `leanprover/lean4:*`
// toolchain that isn't OLD_STABLE or the current stable resolution before
// uninstalling `current`.
async function seedDivergence(): Promise<{ current: string; fallback: string }> {
    for (const t of [OLD_STABLE, STABLE_CHANNEL]) {
        const r = await elanInstallToolchain(undefined, undefined, t)
        assert.ok(
            r.kind === 'Success' || r.kind === 'ToolchainAlreadyInstalled',
            `installing ${t}: ${JSON.stringify(r)}`,
        )
    }
    const setDefault = await elanSetDefaultToolchain(undefined, STABLE_CHANNEL)
    assert.strictEqual(setDefault.kind, 'Success', `elan default ${STABLE_CHANNEL}`)

    const current = await cachedStable()
    assert.ok(current, 'expected a cached resolution for stable after install')

    const installed = await elanInstalledToolchains()
    assert.strictEqual(installed.kind, 'Success', `elan toolchain list: ${JSON.stringify(installed)}`)
    const stray = installed.toolchains.filter(
        t => t.startsWith('leanprover/lean4:') && t !== OLD_STABLE && t !== current,
    )
    if (stray.length > 0) {
        const pruned = await elanUninstallToolchains(undefined, undefined, stray)
        assert.strictEqual(
            pruned.exitCode,
            ExecutionExitCode.Success,
            `pruning residual toolchains ${stray.join(', ')}: ${pruned.combined}`,
        )
    }

    const uninstall = await elanUninstallToolchains(undefined, undefined, [current])
    assert.strictEqual(uninstall.exitCode, ExecutionExitCode.Success, `uninstalling ${current}: ${uninstall.combined}`)

    const fallback = await cachedStable()
    assert.strictEqual(
        fallback,
        OLD_STABLE,
        `expected elan to drop the cached resolution of 'stable' to ${OLD_STABLE} after uninstalling ` +
            `'${current}' (pruned strays: ${stray.length === 0 ? '<none>' : stray.join(', ')}); ` +
            `got '${fallback ?? '<none>'}'`,
    )
    return { current, fallback }
}

async function isInstalled(toolchain: string): Promise<boolean> {
    const r = await elanInstalledToolchains()
    return r.kind === 'Success' && r.toolchains.includes(toolchain)
}

// Each test constructs its own `LeanCommandRunner`, and the sticky
// 'DoNotUpdate' cache is instance-private — so these tests can run in any
// order without one leaking state into the next. Keep that invariant when
// adding new cases: share a runner across tests only if you actively want
// the sticky-decision carryover.
describe('Toolchain update flows (real network)', function () {
    this.timeout(30 * 60_000)

    before(async function () {
        if (!INSTALL_TESTS_ENABLED) {
            this.skip()
        }
        requireIsolatedTestHome({ requireElanHome: true })
        await activateExtension()
    })

    afterEach(afterEachReset)

    it('`UpdateAutomatically` mode installs the resolved toolchain without prompting', async () => {
        const { current } = await seedDivergence()
        assert.strictEqual(await isInstalled(current), false, 'precondition: resolved toolchain is uninstalled')
        await withPrompts(
            [],
            async ({ log }) => {
                const runner = new LeanCommandRunner()
                const decision = await runner.decideToolchain({
                    channel: undefined,
                    context: 'auto-update-test',
                    cwdUri: undefined,
                    toolchainUpdateMode: 'UpdateAutomatically',
                    waitingPrompt: 'Fetching Lean version information',
                })
                assert.strictEqual(
                    decision.kind,
                    'RunWithActiveToolchain',
                    `expected runner to update transparently; got ${JSON.stringify(decision)}`,
                )
                assert.ok(
                    !log.some(p => UPDATE_PROMPT_RE.test(p.message)),
                    `no update prompt should fire; got: ${log.map(p => p.message).join(' / ')}`,
                )
                assert.strictEqual(await isInstalled(current), true, `expected ${current} to be (re)installed`)
            },
            { dismissRemaining: true },
        )
    })

    it('manual prompt → "Update Lean Version" installs the resolved toolchain', async () => {
        const { current } = await seedDivergence()
        assert.strictEqual(await isInstalled(current), false, 'precondition: resolved toolchain is uninstalled')
        await withPrompts(
            [(message: string) => (UPDATE_PROMPT_RE.test(message) ? 'Update Lean Version' : undefined)],
            async ({ log }) => {
                const runner = new LeanCommandRunner()
                const decision = await runner.decideToolchain({
                    channel: undefined,
                    context: 'update-accept-test',
                    cwdUri: undefined,
                    toolchainUpdateMode: 'PromptAboutUpdate',
                    waitingPrompt: 'Fetching Lean version information',
                })
                assert.strictEqual(
                    decision.kind,
                    'RunWithActiveToolchain',
                    `expected runner to update after confirmation; got ${JSON.stringify(decision)}`,
                )
                const fired = log.filter(p => UPDATE_PROMPT_RE.test(p.message))
                assert.strictEqual(fired.length, 1, 'update prompt should have fired exactly once')
                assert.strictEqual(fired[0].chose, 'Update Lean Version')
                assert.strictEqual(
                    await isInstalled(current),
                    true,
                    `expected ${current} to be (re)installed after user confirmed`,
                )
            },
        )
    })

    it('manual prompt → "Use Old Version" keeps the cached toolchain; the decision is sticky', async () => {
        const { current, fallback } = await seedDivergence()
        await withPrompts(
            [(message: string) => (UPDATE_PROMPT_RE.test(message) ? 'Use Old Version' : undefined)],
            async ({ log }) => {
                // Use a single runner instance so the sticky-decision cache set by
                // the first call is visible to the re-probe below.
                const runner = new LeanCommandRunner()
                const decision = await runner.decideToolchain({
                    channel: undefined,
                    context: 'update-decline-test',
                    cwdUri: undefined,
                    toolchainUpdateMode: 'PromptAboutUpdate',
                    waitingPrompt: 'Fetching Lean version information',
                })
                assert.deepStrictEqual(
                    decision,
                    { kind: 'RunWithSpecificToolchain', toolchain: fallback },
                    `expected runner to stick with the cached fallback; got ${JSON.stringify(decision)}`,
                )
                const fired = log.filter(p => UPDATE_PROMPT_RE.test(p.message))
                assert.strictEqual(fired.length, 1, 'update prompt should have fired exactly once')
                assert.strictEqual(fired[0].chose, 'Use Old Version')
                assert.strictEqual(
                    await isInstalled(current),
                    false,
                    `resolved toolchain ${current} should NOT be installed after user declined`,
                )

                // Sticky decision: a subsequent decision on the same key returns
                // the cached toolchain without re-prompting.
                const before = log.length
                const second = await runner.decideToolchain({
                    channel: undefined,
                    context: 'sticky-probe',
                    cwdUri: undefined,
                    toolchainUpdateMode: 'PromptAboutUpdate',
                    waitingPrompt: 'Fetching Lean version information',
                })
                assert.deepStrictEqual(
                    second,
                    { kind: 'RunWithSpecificToolchain', toolchain: fallback },
                    `expected sticky fallback; got ${JSON.stringify(second)}`,
                )
                assert.strictEqual(log.length, before, 'no new prompts should fire during the sticky re-probe')
            },
        )
    })
})
