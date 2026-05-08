import * as assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { QuickPickItemKind, Uri, commands } from 'vscode'
import { activateExtension } from '../helpers/activation'
import { openAndAwaitClient } from '../helpers/client'
import { FIXTURES, scaffoldFromFixture } from '../helpers/fixtures'
import { git, gitText, initGitRepo } from '../helpers/git'
import { assertPromptFired, withPrompts } from '../helpers/prompts'
import { withQuickPicks } from '../helpers/quickPicks'
import { afterEachReset } from '../helpers/teardown'
import { CLIENT_READY_MS } from '../helpers/timeouts'

describe('Project action commands', function () {
    this.timeout(15 * 60_000)

    before(activateExtension)

    afterEach(afterEachReset)

    const openFixture = (projectSubdir: string, fileName: string) =>
        openAndAwaitClient(Uri.file(path.join(FIXTURES, projectSubdir, fileName)), CLIENT_READY_MS)

    describe('on a buildable project', function () {
        let projectDir: string
        let buildDir: string

        // Per-test scaffold: each `it` gets its own tmpdir so `.lake/build/`
        // starts absent. Without it, test 1's build would leave artifacts that
        // make test 2's `precondition: .lake/build/ exists after build`
        // assertion pass even if `lean4.project.build` itself became a no-op
        // — exactly the failure the precondition is meant to catch.
        beforeEach(async () => {
            projectDir = scaffoldFromFixture('buildable-project', 'lean4-build-')
            buildDir = path.join(projectDir, '.lake', 'build')
            assert.ok(!fs.existsSync(buildDir), 'precondition: .lake/build/ must not exist before build')
            await openAndAwaitClient(Uri.file(path.join(projectDir, 'Main.lean')), CLIENT_READY_MS)
        })

        // No `after()` cleanup — see comment on 'with a local git dependency'.

        it('`lean4.project.build` builds the project successfully', async () => {
            await withPrompts([], async ({ log }) => {
                await commands.executeCommand('lean4.project.build')
                assertPromptFired(log, { kind: 'info', messagePattern: /built successfully/ })
            }, { dismissRemaining: true })
            assert.ok(fs.existsSync(buildDir), '.lake/build/ should exist after build')
        })

        it('`lean4.project.clean` deletes build artifacts when confirmed and does not rebuild when declined', async () => {
            // First, build so there *are* artifacts to clean.
            await withPrompts([], async () => {
                await commands.executeCommand('lean4.project.build')
            }, { dismissRemaining: true })

            // `lake clean` removes `.lake/build/` but leaves `.lake/` itself
            // (packages, manifests, etc.) in place.
            assert.ok(fs.existsSync(buildDir), 'precondition: .lake/build/ exists after build')

            // `Proceed` = confirm delete. The rebuild prompt is intentionally
            // dismissed (`dismissRemaining`) so the test does not trigger
            // another build.
            await withPrompts(['Proceed'], async ({ log }) => {
                await commands.executeCommand('lean4.project.clean')
                assertPromptFired(log, { messagePattern: /Delete all build artifacts/, chose: 'Proceed' })
                assertPromptFired(log, { messagePattern: /rebuild the project/, dismissed: true })
                assert.ok(!fs.existsSync(buildDir), '.lake/build/ should be gone after clean')
            }, { dismissRemaining: true })
        })
    })

    describe('on a non-Mathlib project', function () {
        beforeEach(async () => {
            await openFixture('lean-project', 'Main.lean')
        })

        for (const cmd of ['fetchCache', 'fetchFileCache', 'fetchAllOpenFileCaches'] as const) {
            it(`\`lean4.project.${cmd}\` reports that the command is unavailable`, async () => {
                await withPrompts([], async ({ log }) => {
                    await commands.executeCommand(`lean4.project.${cmd}`)
                    assertPromptFired(log, { kind: 'error', messagePattern: /non-Mathlib projects/ })
                }, { dismissRemaining: true })
            })
        }

        it('`lean4.project.fetchOpenFileCaches` picks open files then reports unavailable', async () => {
            // `kind=undefined` shows a quick-pick of open Lean files. Select
            // all non-separator items so the command proceeds to the cache
            // fetch (which then fails with CacheUnavailable in a non-Mathlib
            // project — the observable we assert).
            await withQuickPicks(
                [items => items.filter(i => i.kind !== QuickPickItemKind.Separator)],
                async picks => {
                    await withPrompts([], async ({ log }) => {
                        await commands.executeCommand('lean4.project.fetchOpenFileCaches')
                        assert.strictEqual(picks.log.length, 1, 'file-selection quick-pick should be shown once')
                        assert.ok(
                            Array.isArray(picks.log[0].chose) && picks.log[0].chose.length > 0,
                            `expected at least one file selected; got ${JSON.stringify(picks.log[0].chose)}`,
                        )
                        assertPromptFired(log, { kind: 'error', messagePattern: /non-Mathlib projects/ })
                    }, { dismissRemaining: true })
                },
            )
        })
    })

    // The `lean4.project.fetchCache` family checks whether a project has a
    // `cache` lake exe (via `lake exe cache`) and, if so, runs `lake exe cache
    // get [files]`. We don't need real Mathlib: the `mock-mathlib-cache`
    // fixture provides a trivial `lean_exe` named `cache` that writes a
    // sentinel file recording the args it was invoked with — enough to
    // exercise the happy path end-to-end without hitting the network AND
    // to assert that the production code actually invoked `lake exe cache`
    // (a regression where the success prompt is shown without the lake
    // shell-out would otherwise pass silently).
    describe('on a mock-Mathlib project', function () {
        let projectDir: string
        let sentinelPath: string

        // Per-test scaffold: each `it` gets its own tmpdir so the sentinel
        // file (which the fake `cache` exe writes on each invocation) starts
        // absent and can be checked unambiguously. The trade-off is one
        // `LeanClient` per test (~few seconds of warm startup each); for
        // four tests in this block, that's well within the suite timeout.
        beforeEach(async () => {
            projectDir = scaffoldFromFixture('mock-mathlib-cache', 'lean4-mockcache-')
            sentinelPath = path.join(projectDir, 'cache-invoked.txt')
            assert.ok(!fs.existsSync(sentinelPath), 'precondition: sentinel must not exist before invocation')
            await openAndAwaitClient(Uri.file(path.join(projectDir, 'Main.lean')), CLIENT_READY_MS)
        })

        // No `after()` cleanup — see comment on 'with a local git dependency'.

        // `fetchCache` reports success per-project; `fetchFileCache` and
        // `fetchAllOpenFileCaches` report success per-file (with different
        // wording). Share the execute/assert shape, vary only the message
        // pattern.
        const successCases: {
            cmd: 'fetchCache' | 'fetchFileCache' | 'fetchAllOpenFileCaches'
            messagePattern: RegExp
        }[] = [
            { cmd: 'fetchCache', messagePattern: /cache fetched successfully/ },
            { cmd: 'fetchFileCache', messagePattern: /cache for open file\(s\) fetched successfully/ },
            { cmd: 'fetchAllOpenFileCaches', messagePattern: /cache for open file\(s\) fetched successfully/ },
        ]
        for (const { cmd, messagePattern } of successCases) {
            it(`\`lean4.project.${cmd}\` reports success`, async () => {
                await withPrompts([], async ({ log }) => {
                    await commands.executeCommand(`lean4.project.${cmd}`)
                    assertPromptFired(log, { kind: 'info', messagePattern })
                }, { dismissRemaining: true })
                assert.ok(
                    fs.existsSync(sentinelPath),
                    `expected \`lake exe cache\` to have been invoked; sentinel ${sentinelPath} was not written`,
                )
            })
        }

        it('`lean4.project.fetchOpenFileCaches` picks files then reports success', async () => {
            await withQuickPicks(
                [items => items.filter(i => i.kind !== QuickPickItemKind.Separator)],
                async picks => {
                    await withPrompts([], async ({ log }) => {
                        await commands.executeCommand('lean4.project.fetchOpenFileCaches')
                        assert.strictEqual(picks.log.length, 1, 'file-selection quick-pick should be shown once')
                        assert.ok(
                            Array.isArray(picks.log[0].chose) && picks.log[0].chose.length > 0,
                            `expected at least one file selected; got ${JSON.stringify(picks.log[0].chose)}`,
                        )
                        assertPromptFired(log, {
                            kind: 'info',
                            messagePattern: /cache for open file\(s\) fetched successfully/,
                        })
                    }, { dismissRemaining: true })
                },
            )
            assert.ok(
                fs.existsSync(sentinelPath),
                `expected \`lake exe cache\` to have been invoked; sentinel ${sentinelPath} was not written`,
            )
        })
    })

    // `selectProjectToolchain` rewrites the project's `lean-toolchain` file,
    // so we need a throwaway copy of a project rather than running against a
    // shared in-tree fixture. `lean-project` is sufficient: the test only
    // cares that there's a Lean client to attach to and a `lean-toolchain` to
    // overwrite.
    describe('in a throwaway project', function () {
        let projectDir: string

        before(function () {
            projectDir = scaffoldFromFixture('lean-project', 'lean4-selecttc-')
        })

        // No `after()` cleanup — see comment on 'with a local git dependency'.

        it('`lean4.project.selectProjectToolchain` writes the chosen toolchain', async () => {
            await openAndAwaitClient(Uri.file(path.join(projectDir, 'Main.lean')), CLIENT_READY_MS)

            // Pin the pick to "the first installed leanprover/lean4 toolchain"
            // rather than matching any `^leanprover/lean4:` label. The previous
            // regex form selected whichever item floated to the top of the
            // quick-pick list, which mixes installed and downloadable items —
            // the latter changes as elan adds nightly/beta releases, so the
            // chosen item could differ across runs. The production code tags
            // installed items with `description === '(installed)'`
            // (`elanCommands.ts:497-500`); filtering by that gives us a
            // deterministic choice within the current test environment, where
            // openAndAwaitClient above has already triggered an install of
            // whatever toolchain `lean-project/lean-toolchain` references.
            let pickedLabel: string | undefined
            const toolchainPath = path.join(projectDir, 'lean-toolchain')
            await withQuickPicks(
                [
                    items => {
                        const installed = items.find(
                            i => i.description === '(installed)' && /^leanprover\/lean4:/.test(i.label),
                        )
                        assert.ok(
                            installed,
                            `expected at least one installed leanprover/lean4 toolchain; got labels [${items
                                .map(i => i.label)
                                .join(' | ')}]`,
                        )
                        pickedLabel = installed.label
                        return installed
                    },
                ],
                async picks => {
                    await withPrompts(['Proceed'], async ({ log }) => {
                        await commands.executeCommand('lean4.project.selectProjectToolchain')
                        assert.strictEqual(picks.log.length, 1, 'toolchain quick-pick should be shown once')
                        assert.strictEqual(
                            picks.log[0].chose,
                            pickedLabel,
                            'the picker should record the same label our function selected',
                        )
                        assertPromptFired(log, { messagePattern: /Do you wish to proceed\?/, chose: 'Proceed' })
                        assert.ok(
                            log.every(p => p.kind !== 'error'),
                            `unexpected error prompt: ${log.filter(p => p.kind === 'error').map(p => p.message).join(' / ')}`,
                        )
                        assert.ok(pickedLabel, 'pickedLabel should have been set by the answer function')
                        assert.strictEqual(
                            fs.readFileSync(toolchainPath, 'utf8'),
                            pickedLabel,
                            'lean-toolchain should contain the picked toolchain exactly (no trailing newline)',
                        )
                    }, { dismissRemaining: true })
                },
            )
        })
    })

    // The `local-dep-pair` fixture stages two sibling projects, `dep/` and
    // `consumer/`, where `consumer/lakefile.toml` references `dep/` via a
    // relative git URL (`git = "../dep"`). After `scaffoldFromFixture`
    // copies both into the same tmpdir, the relative URL resolves correctly
    // — letting us exercise `updateDependency` end-to-end without hitting
    // the network or pulling in Mathlib.
    describe('with a local git dependency', function () {
        let pairDir: string
        let consumerDir: string

        before(function () {
            pairDir = scaffoldFromFixture('local-dep-pair', 'lean4-updatedep-')
            const depDir = path.join(pairDir, 'dep')
            consumerDir = path.join(pairDir, 'consumer')
            // The `dep/` half must be a real git repo for the consumer's
            // `git = "../dep"` require to clone it. The `.git` directory is
            // created at runtime rather than checked into the fixture.
            initGitRepo(depDir)
            // `lake update` resolves `main` to a specific commit and records
            // it in `lake-manifest.json`. Pipe stdio so stderr is captured
            // and surfaced in the thrown error rather than streamed to the
            // runner — same shape as `helpers/git.ts`. The default `lake
            // update` failure ("Command failed: lake update") gives no clue
            // why; surfacing stderr names the actual cause.
            try {
                execFileSync('lake', ['update'], {
                    cwd: consumerDir,
                    env: process.env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                })
            } catch (e) {
                const err = e as { message: string; stderr?: Buffer; stdout?: Buffer }
                const stderr = err.stderr?.toString().trim() ?? ''
                const stdout = err.stdout?.toString().trim() ?? ''
                const detail = [stderr, stdout].filter(Boolean).join('\n--\n') || '(no output captured)'
                throw new Error(`\`lake update\` failed in ${consumerDir}: ${err.message}\n${detail}`)
            }
        })

        // No `after()` cleanup: VS Code keeps file watchers on the opened
        // folder for the remainder of the session, and eagerly deleting the
        // tmpdir triggers "setup information for file that does not exist"
        // errors in subsequent tests. It's under LEAN4_TEST_HOME, which is
        // wiped between test runs, so leaking it is fine.

        it('`lean4.project.updateDependency` updates the selected local dep', async () => {
            // Read the manifest rev that was recorded by the `before`'s
            // initial `lake update`. After `updateDependency` runs we expect
            // a NEW rev — without a fresh dep commit between the two updates,
            // lake's resolution of `main` would point to the same SHA and the
            // assertion couldn't distinguish "command ran and re-resolved"
            // from "command didn't run at all". Add a commit to dep here so
            // there's a strictly newer HEAD for `lake update` to find.
            const manifestPath = path.join(consumerDir, 'lake-manifest.json')
            const readDepRev = (): string => {
                const manifest: { packages: { name: string; rev: string }[] } = JSON.parse(
                    fs.readFileSync(manifestPath, 'utf8'),
                )
                const dep = manifest.packages.find(p => p.name === 'dep')
                assert.ok(dep, `'dep' package not found in ${manifestPath}`)
                return dep.rev
            }
            const beforeRev = readDepRev()

            const depDir = path.join(pairDir, 'dep')
            fs.writeFileSync(path.join(depDir, 'Bump.lean'), '-- bump\n')
            git(depDir, 'add', '.')
            git(depDir, 'commit', '-m', 'Bump for updateDependency test')

            await openAndAwaitClient(Uri.file(path.join(consumerDir, 'Consumer.lean')), CLIENT_READY_MS)

            await withQuickPicks(['dep'], async picks => {
                await withPrompts(['Proceed'], async ({ log }) => {
                    await commands.executeCommand('lean4.project.updateDependency')
                    assert.strictEqual(picks.log.length, 1, 'dependency quick-pick should be shown once')
                    assert.strictEqual(picks.log[0].chose, 'dep', 'dep should be the selected dependency')
                    assertPromptFired(log, {
                        kind: 'warn',
                        messagePattern: /update dep/,
                        chose: 'Proceed',
                    })
                    assert.ok(
                        log.every(p => p.kind !== 'error'),
                        `unexpected error prompt: ${log.filter(p => p.kind === 'error').map(p => p.message).join(' / ')}`,
                    )
                }, { dismissRemaining: true })
            })

            const afterRev = readDepRev()
            assert.notStrictEqual(
                afterRev,
                beforeRev,
                `manifest rev should have rotated (was ${beforeRev}); update did not actually re-resolve dep`,
            )
            const expectedRev = gitText(depDir, 'rev-parse', 'HEAD').trim()
            assert.strictEqual(
                afterRev,
                expectedRev,
                'manifest rev should match the bump commit just made on dep main',
            )
        })
    })
})
