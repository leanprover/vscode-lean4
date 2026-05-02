import { defineConfig } from '@vscode/test-cli'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { cliTestNames } from './scripts/cliTestNames.mjs'
import { setupTestHome } from './scripts/testHome.mjs'

// VS Code's own --user-data-dir / --extensions-dir are NOT overridden on purpose:
// @vscode/test-electron installs extensionDependencies into its cache dir
// (~/.vscode-test/extensions) and would not see them if we redirected --extensions-dir.
// Its defaults already live outside the developer's real ~/.vscode, so that's enough.
const { baseEnv } = setupTestHome()

const fixtures = path.resolve('./test/fixtures')

// Wipe the failure-state-dump dir once per `vscode-test` invocation so each
// `npm run test:*` starts fresh. We can't do this from `helpers/teardown.ts`
// anymore — under the per-file `cli-*` label scheme below, that helper's
// module-load wipe runs once per VS Code instance and would clobber dumps
// from earlier files in the same run. `runCliTests.mjs` runs one
// `vscode-test` per label, so it sets `LEAN4_TEST_OUTPUT_WIPED=1` after
// performing its own wipe — which signals us to skip the wipe here so dumps
// from earlier labels survive.
const cliOutputDir = path.resolve('./vscode-test-cli-output')
if (process.env.LEAN4_TEST_OUTPUT_WIPED !== '1') {
    fs.rmSync(cliOutputDir, { recursive: true, force: true })
}
fs.mkdirSync(cliOutputDir, { recursive: true })

// Force Electron to the X11 backend on Linux. Without this, modern VS Code
// Electron builds default to `--ozone-platform-hint=auto`, which connects to
// Wayland whenever `WAYLAND_DISPLAY` is set — including under `xvfb-run`,
// because xvfb only sets `DISPLAY` and doesn't unset Wayland-side env. The
// `ELECTRON_OZONE_PLATFORM_HINT` env var alone can be overridden by VS Code's
// Electron, so we pass the binding `--ozone-platform=x11` CLI flag. Outside
// xvfb, X11 still works via XWayland on Wayland sessions, so this flag is safe
// to set unconditionally on Linux. macOS/Windows ignore it.
const linuxHeadlessArgs = process.platform === 'linux' ? ['--ozone-platform=x11'] : []

const common = {
    version: 'stable',
    mocha: { ui: 'bdd', timeout: 120_000, color: true },
    launchArgs: ['--disable-workspace-trust', ...linuxHeadlessArgs],
    env: baseEnv,
}

// The nightly, elan-install, and vscode-test-cli suites all install a toolchain
// on first run and benefit from a generous default. Leaving them on the 120s
// common default would mean any test that forgets its own `this.timeout` fails
// the moment lake or elan starts a real download.
const longRunning = { ...common.mocha, timeout: 15 * 60_000 }

// Each vscode-test-cli test file runs in its own VS Code instance so state
// (open documents that linger in `workspace.textDocuments`, `LeanClient`
// instances, captured output channels) can't leak across files. Within a
// file, multiple tests still share the instance — `afterEach(afterEachReset)`
// covers intra-file cleanup. Cost: ~5-10s of VS Code startup per file
// (~45-90s added to a full vscode-test-cli run). New test files in
// `test/vscode-test-cli/` are auto-discovered via `scripts/cliTestNames.mjs`
// — no edits here or in `package.json` are required.
export default defineConfig([
    {
        label: 'nightly',
        files: 'out/test/nightly/**/*.test.js',
        workspaceFolder: path.join(fixtures, 'empty-workspace'),
        ...common,
        mocha: longRunning,
    },
    {
        // Subset of the nightly suite covering only the elan bootstrap. Run
        // on the Windows CI job so we get coverage of elan's Windows installer
        // path without pulling in the other nightly tests (which depend on
        // lake/git/network behaviour we don't yet exercise on Windows).
        label: 'elan-install',
        files: 'out/test/nightly/elan-install.test.js',
        workspaceFolder: path.join(fixtures, 'empty-workspace'),
        ...common,
        mocha: longRunning,
    },
    ...cliTestNames.map(name => ({
        label: `cli-${name}`,
        files: `out/test/vscode-test-cli/${name}.test.js`,
        workspaceFolder: path.join(fixtures, 'lean-project'),
        ...common,
        mocha: longRunning,
    })),
])
