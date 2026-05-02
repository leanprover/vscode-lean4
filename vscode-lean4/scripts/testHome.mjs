import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Shared between `.vscode-test.mjs` and `wdio.conf.mjs`: set up a fresh,
// isolated HOME for a test run so elan toolchains, git config, and anything
// else the extension or Lean toolchain reads from $HOME land in a sandbox.
// The developer's real ~/.elan is never touched.
//
// CI override: `LEAN4_TEST_HOME_OVERRIDE` pins HOME to a stable, cacheable
// path so the toolchain download survives between runs. The nightly suite's
// `requireIsolatedTestHome` (in `test/helpers/testHome.ts`) accepts paths
// that either realpath-match `LEAN4_TEST_HOME_OVERRIDE` or are an
// `mkdtempSync('lean4-test-home-')` output directly under
// `<homedir>/.cache/lean4-vscode-tests/`.
//
// Returns `{ testHome, baseEnv }`. The caller decides whether to attach
// `baseEnv` to a child-process launch config (`.vscode-test.mjs`) or to
// splat it onto `process.env` for the current process (`wdio.conf.mjs`,
// where wdio-vscode-service has no direct env hook).
export function setupTestHome() {
    let testHome
    if (process.env.LEAN4_TEST_HOME_OVERRIDE) {
        testHome = process.env.LEAN4_TEST_HOME_OVERRIDE
        fs.mkdirSync(testHome, { recursive: true })
    } else {
        // Default to a persistent per-user cache dir rather than os.tmpdir(): many
        // Linux distros (Fedora, Arch) mount /tmp as tmpfs with a quota smaller than
        // the ~1.5GB a Lean toolchain expands to. Using ~/.cache avoids that and
        // survives cross-run, so cached downloads speed up subsequent local runs.
        // Use the `lean4-test-home-` prefix so the nightly suite's safety check
        // (`requireIsolatedTestHome` in `test/helpers/testHome.ts`) recognizes
        // the directory as an `mkdtempSync` output under our cache dir.
        const base = path.join(os.homedir(), '.cache', 'lean4-vscode-tests')
        fs.mkdirSync(base, { recursive: true })
        testHome = fs.mkdtempSync(path.join(base, 'lean4-test-home-'))
    }

    const baseEnv = {
        HOME: testHome,
        USERPROFILE: testHome,
        ELAN_HOME: path.join(testHome, '.elan'),
        LEAN4_TEST_HOME: testHome,
        // Prevent git from ascending past `testHome` while searching for a
        // repository. CI sets `LEAN4_TEST_HOME_OVERRIDE` to a path inside the
        // workspace (which is itself a git checkout from `actions/checkout`),
        // so without a ceiling, every `git`/`lake init` invocation inside a
        // test fixture walks up and finds the workspace's `.git` — skipping
        // its own `git init` because the directory is "already" inside a
        // repo, and silently committing test artifacts into the parent
        // checkout. Locally the default `LEAN4_TEST_HOME` lives under
        // `~/.cache/` outside any repo, so the bug doesn't reproduce there.
        GIT_CEILING_DIRECTORIES: testHome,
    }

    // Pre-seed settings.toml so detached/untitled Lean files resolve a default
    // toolchain. Locally this is the only way an isolated empty ELAN_HOME gets
    // one; in CI the cached ELAN_HOME already has this file (from `elan-init`),
    // so skip to avoid stripping any other fields elan recorded there.
    //
    // Let `elan` write the file itself rather than hand-rolling TOML: modern
    // elan requires a `version` key whose schema has changed over time, and any
    // file we produce by hand goes stale the next time elan bumps it. A stale
    // cached settings.toml from an older run also counts: if it lacks `version`,
    // delete and re-seed via elan so the next run picks up the current schema.
    fs.mkdirSync(baseEnv.ELAN_HOME, { recursive: true })
    const settingsPath = path.join(baseEnv.ELAN_HOME, 'settings.toml')
    if (fs.existsSync(settingsPath) && !/^\s*version\s*=/m.test(fs.readFileSync(settingsPath, 'utf8'))) {
        fs.rmSync(settingsPath)
    }
    if (!fs.existsSync(settingsPath)) {
        try {
            execFileSync('elan', ['default', 'leanprover/lean4:stable'], {
                env: { ...process.env, ...baseEnv },
                stdio: ['ignore', 'pipe', 'pipe'],
            })
        } catch (e) {
            if (e.code === 'ENOENT') {
                // Nightly and elan-install-windows jobs set
                // `LEAN4_TEST_ELAN_INSTALL=1` (see `package.json` `test:nightly` /
                // `test:elan-install`) and deliberately run without elan on PATH —
                // the elan-install test installs elan as part of what it tests.
                // For every other flow, missing elan is a setup error; surface it
                // now rather than minutes into a per-label run with an opaque
                // "client failed to start" symptom many layers removed from the
                // actual cause.
                if (process.env.LEAN4_TEST_ELAN_INSTALL === '1') return { testHome, baseEnv }
                throw new Error(
                    '`elan` was not found on PATH. The default `npm test` flow assumes elan ' +
                        'is installed on the host. Install it from https://lean-lang.org/elan/ ' +
                        'or run `npm run test:nightly` (which installs elan itself).',
                )
            }
            // Anything else (network error, corrupt elan state, unexpected
            // exit code) would otherwise bubble up as an opaque
            // `Command failed: elan default leanprover/lean4:stable` with no
            // captured output. Rethrow with elan's actual stderr/stdout so
            // the test runner's output points at the real cause.
            const stderr = e.stderr?.toString().trim() ?? ''
            const stdout = e.stdout?.toString().trim() ?? ''
            const detail = [stderr, stdout].filter(Boolean).join('\n--\n') || '(no output captured)'
            throw new Error(
                'failed to seed default toolchain via `elan default leanprover/lean4:stable` ' +
                    `(ELAN_HOME=${baseEnv.ELAN_HOME}): ${e.message}\n${detail}`,
            )
        }
    }

    return { testHome, baseEnv }
}
