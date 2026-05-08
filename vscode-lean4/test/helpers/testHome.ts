import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Suffix shape produced by `fs.mkdtempSync` (six chars from libuv's
// alphabet). Anchored on both ends so a path like `/.../lean4-test-home-foo/bar`
// fails the basename check.
const MKDTEMP_SUFFIX = /^lean4-test-home-[A-Za-z0-9]{6}$/

// Returns the isolated `LEAN4_TEST_HOME` and asserts it was set by the test
// harness. Pass `{ requireElanHome: true }` in suites that mutate elan state
// to additionally confirm `ELAN_HOME` is nested under the isolated home — the
// safety marker that prevents accidentally wiping the developer's real ~/.elan.
//
// All comparisons resolve through `fs.realpathSync` first so a symlinked
// home dir, case-folding filesystem, or `LEAN4_TEST_HOME_OVERRIDE` pointing
// through a symlink can't sneak past structural equality. Two shapes are
// accepted (mirroring `scripts/testHome.mjs`):
//   1. `LEAN4_TEST_HOME_OVERRIDE` set: realpath(testHome) === realpath(override).
//   2. Default: testHome is `mkdtempSync('lean4-test-home-')` directly under
//      `<homedir>/.cache/lean4-vscode-tests/`.
export function requireIsolatedTestHome(
    { requireElanHome = false }: { requireElanHome?: boolean } = {},
): { testHome: string; elanHome: string } {
    const testHome = process.env.LEAN4_TEST_HOME ?? ''
    const elanHome = process.env.ELAN_HOME ?? ''

    assert.ok(testHome, 'refusing to run: LEAN4_TEST_HOME is unset')
    assert.ok(
        fs.existsSync(testHome),
        `refusing to run: LEAN4_TEST_HOME (${testHome}) does not exist`,
    )
    const realTestHome = fs.realpathSync(testHome)

    const override = process.env.LEAN4_TEST_HOME_OVERRIDE
    if (override) {
        assert.ok(
            fs.existsSync(override),
            `refusing to run: LEAN4_TEST_HOME_OVERRIDE (${override}) is set but does not exist`,
        )
        assert.strictEqual(
            realTestHome,
            fs.realpathSync(override),
            `refusing to run: LEAN4_TEST_HOME (${realTestHome}) does not match LEAN4_TEST_HOME_OVERRIDE`,
        )
    } else {
        const defaultBase = path.join(os.homedir(), '.cache', 'lean4-vscode-tests')
        assert.ok(
            fs.existsSync(defaultBase),
            `refusing to run: expected default test-home base ${defaultBase} does not exist`,
        )
        assert.strictEqual(
            path.dirname(realTestHome),
            fs.realpathSync(defaultBase),
            `refusing to run: LEAN4_TEST_HOME (${realTestHome}) is not directly under ${defaultBase}`,
        )
        assert.match(
            path.basename(realTestHome),
            MKDTEMP_SUFFIX,
            `refusing to run: LEAN4_TEST_HOME basename (${path.basename(realTestHome)}) is not an mkdtemp output`,
        )
    }

    if (requireElanHome) {
        assert.ok(elanHome, 'refusing to run: ELAN_HOME is unset')
        assert.ok(
            fs.existsSync(elanHome),
            `refusing to run: ELAN_HOME (${elanHome}) does not exist`,
        )
        const realElanHome = fs.realpathSync(elanHome)
        assert.strictEqual(
            path.dirname(realElanHome),
            realTestHome,
            `refusing to run: ELAN_HOME (${realElanHome}) is not directly under LEAN4_TEST_HOME (${realTestHome})`,
        )
        assert.strictEqual(
            path.basename(realElanHome),
            '.elan',
            `refusing to run: ELAN_HOME basename (${path.basename(realElanHome)}) is not '.elan'`,
        )
    }
    return { testHome, elanHome }
}

// Creates a scratch work directory under the isolated test HOME with the given
// prefix. Throwaway project fixtures should live here — see the comment in
// testHome.mjs about tmpfs quotas.
export function makeTestWorkDir(prefix: string): string {
    const { testHome } = requireIsolatedTestHome()
    return fs.mkdtempSync(path.join(testHome, prefix))
}
