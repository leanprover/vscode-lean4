import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupTestHome } from './scripts/testHome.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Same isolated-HOME mechanism as .vscode-test.mjs. The spawned VS Code inherits
// process.env, so mutating HOME/ELAN_HOME here is enough — wdio-vscode-service
// does not expose a direct `env` option on its capabilities.
const { testHome, baseEnv } = setupTestHome()
Object.assign(process.env, baseEnv)

const extensionPath = __dirname
const fixturePath = path.join(extensionPath, 'test', 'fixtures', 'infoview-project')

// Pin storagePath so the wdio-vscode-service extensions dir is stable — we need
// to pre-install `tamasfe.even-better-toml` there because VS Code does not
// auto-install `extensionDependencies` when launching the extension under test
// via `--extension-development-path`.
const storagePath = path.join(testHome, 'wdio-storage')
fs.mkdirSync(path.join(storagePath, 'extensions'), { recursive: true })

// Single landing dir for everything CI should be able to upload as artifacts:
// the spec-runner's stdout (always), the junit reporter's XML (always), the
// failure screenshots written by `afterTest` (on failure), and VS Code's own
// log files dropped via `--logsPath` (always — the directory grows with each
// run and gets re-created fresh each time).
const outputDir = path.join(extensionPath, 'wdio-output')
const vscodeLogsDir = path.join(outputDir, 'vscode-logs')
fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(vscodeLogsDir, { recursive: true })

export const config = {
    runner: 'local',
    specs: ['./out/test/wdio/**/*.test.js'],
    maxInstances: 1,
    outputDir,
    capabilities: [
        {
            browserName: 'vscode',
            browserVersion: 'stable',
            'wdio:vscodeOptions': {
                extensionPath,
                storagePath,
                workspacePath: fixturePath,
                vscodeArgs: {
                    'disable-workspace-trust': true,
                    // Override wdio-vscode-service's default `disableExtensions: true`
                    // so our `extensionDependencies` (Even Better TOML) loads.
                    'disable-extensions': false,
                    // Point VS Code's log files at our output dir so a CI
                    // failure can grep `<outputDir>/vscode-logs/` for extension
                    // host crashes / LSP errors / unhandled rejections.
                    'logs-path': vscodeLogsDir,
                    // Force Electron to the X11 backend on Linux. Without this,
                    // modern VS Code Electron builds prefer Wayland whenever
                    // `WAYLAND_DISPLAY` is set — including under `xvfb-run`,
                    // since xvfb only sets `DISPLAY` and leaves Wayland-side
                    // env alone. Same rationale as in `.vscode-test.mjs`.
                    ...(process.platform === 'linux' ? { 'ozone-platform': 'x11' } : {}),
                },
            },
        },
    ],
    logLevel: 'warn',
    framework: 'mocha',
    reporters: [
        'spec',
        // Machine-readable artifact for `actions/upload-artifact` + a junit
        // reporter step. Lands in `<outputDir>/wdio-junit-reporter-*.xml`.
        ['junit', { outputDir, outputFileFormat: opts => `wdio-junit-${opts.cid}.xml` }],
    ],
    mochaOpts: {
        ui: 'bdd',
        timeout: 15 * 60_000,
    },
    services: ['vscode'],
    // VS Code 1.118+ ships a "Build with Agent" chat welcome view that
    // auto-opens in the secondary side bar / auxiliary bar. The InfoView
    // webview opens to the right of the active editor (column 2) and the
    // auxiliary bar lands on top of (or right next to) that column —
    // wdio click attempts on the InfoView iframe get intercepted by the
    // overlapping `<div class="chat-welcome-view">` / `chat-welcome-view-icon`.
    // No first-party setting reliably suppresses the auxiliary-bar default
    // visibility across VS Code versions, so we just close it via command
    // before every test. Idempotent — closing an already-closed aux bar is
    // a no-op.
    async beforeTest() {
        await browser.executeWorkbench(async vscode => {
            await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
        })
    },
    // On test failure, capture a screenshot of the workbench so a CI run's
    // "expected `(paused)` label" / `waitForInfoView` timeouts have a visual
    // record. Filename derives from the describe + it titles, normalized to
    // `[a-z0-9-]+`. Screenshots land in the same `outputDir` as the junit
    // report so a single artifact upload covers everything.
    async afterTest(test, _context, result) {
        if (!result.error) return
        const safe = `${test.parent} ${test.title}`
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
        const file = path.join(outputDir, `${safe}.png`)
        try {
            await browser.saveScreenshot(file)
            console.log(`[wdio] screenshot saved: ${file}`)
        } catch (e) {
            console.error(`[wdio] failed to save screenshot for "${test.title}": ${e}`)
        }
    },
    // VS Code does not auto-install `extensionDependencies` when launching the
    // extension under test via `--extension-development-path`, so we shell out
    // to the bundled `code` CLI and pre-install Even Better TOML. This must
    // run *after* wdio-vscode-service's launcher onPrepare has finished
    // downloading VS Code into `.wdio-vscode-service/`.
    //
    // `@wdio/cli` runs hooks in this order (see @wdio/cli/build/launcher.js):
    //   1. `runLauncherHook(config.onPrepare, …)`   — top-level onPrepare
    //   2. `runServiceHook(launchers, 'onPrepare')` — services concurrently
    //   3. setup driver/browser
    //   4. for each worker: `runLauncherHook(config.onWorkerStart, …)`
    //
    // So `config.onPrepare` (top-level) runs *before* wdio-vscode-service's
    // download — putting the install there deadlocks. `onWorkerStart` runs
    // after the service hooks and therefore after the download has produced
    // the `is-complete` marker.
    async onWorkerStart() {
        const cacheDir = path.join(extensionPath, '.wdio-vscode-service')
        const dirPrefix = `vscode-${process.platform}-`
        const entries = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []
        const vscodeDir = entries.find(
            e => e.startsWith(dirPrefix) && fs.existsSync(path.join(cacheDir, e, 'is-complete')),
        )
        if (!vscodeDir) {
            throw new Error(
                `wdio-vscode-service did not produce a completed VS Code download in ${cacheDir} ` +
                    `before onWorkerStart fired (entries: ${entries.join(', ') || '<empty>'})`,
            )
        }
        const extensionsDir = path.join(storagePath, 'extensions')
        const alreadyInstalled = fs
            .readdirSync(extensionsDir)
            .some(name => name.startsWith('tamasfe.even-better-toml-'))
        if (alreadyInstalled) return
        const codeCli = path.join(cacheDir, vscodeDir, 'bin', 'code')
        console.log(`[wdio] installing tamasfe.even-better-toml into ${extensionsDir}`)
        try {
            execFileSync(
                codeCli,
                [
                    '--extensions-dir',
                    extensionsDir,
                    '--user-data-dir',
                    path.join(storagePath, 'settings'),
                    '--install-extension',
                    'tamasfe.even-better-toml',
                    '--force',
                ],
                { stdio: 'inherit', env: process.env },
            )
        } catch (e) {
            // The underlying `code --install-extension` failure (network down,
            // marketplace 5xx, etc.) has already printed to the user's terminal
            // because `stdio: 'inherit'`. `execFileSync` itself throws an opaque
            // `Command failed: …` — wrap it with the high-level context so the
            // wdio launcher's failure message names the real cause.
            throw new Error(
                'Failed to install `tamasfe.even-better-toml` from the marketplace. ' +
                    'The wdio test suite needs network access on first run to fetch this ' +
                    'extension (it is an `extensionDependencies` entry that VS Code does not ' +
                    'auto-install under `--extension-development-path`). See the `code ' +
                    '--install-extension` output above for the underlying cause.\n' +
                    `Original error: ${(e instanceof Error ? e.message : String(e))}`,
            )
        }
    },
    // No `onComplete` cleanup of `.lake/`: it's gitignored
    // (`vscode-lean4/test/fixtures/**/.lake/`), and lake invalidates incremental
    // build artifacts on toolchain or source changes — a warm cache between
    // runs is harmless and faster.
}
