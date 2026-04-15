import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTestHome } from './scripts/testHome.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// wdio loads this file in the launcher and in the worker. Thus this file does
// not delete files. `scripts/runWdio.mjs` does the one-time work of a run:
// it prepares the test home, deletes the output and the user data of the last
// run, and sets `LEAN4_WDIO_VSCODE_VERSION`.

// Same isolated HOME as in `.vscode-test.mjs`. The spawned VS Code inherits
// `process.env`: wdio-vscode-service has no `env` option.
const { baseEnv } = getTestHome()
Object.assign(process.env, baseEnv)

const vscodeVersion = process.env.LEAN4_WDIO_VSCODE_VERSION ?? 'stable'

const extensionPath = __dirname
const fixturePath = path.join(extensionPath, 'test', 'fixtures', 'infoview-project')

// wdio-vscode-service uses `<storagePath>/settings` as the user data folder.
// `scripts/runWdio.mjs` deletes it before each run.
const storagePath = path.join(extensionPath, '.wdio-vscode-service', 'storage')

// The output for CI: JUnit results, screenshots of failures, and the VS Code logs.
const outputDir = path.join(extensionPath, 'wdio-output')
const vscodeLogsDir = path.join(outputDir, 'vscode-logs')
fs.mkdirSync(vscodeLogsDir, { recursive: true })

export const config = {
    runner: 'local',
    specs: ['./out/test/wdio/**/*.test.js'],
    maxInstances: 1,
    outputDir,
    capabilities: [
        {
            browserName: 'vscode',
            browserVersion: vscodeVersion,
            'wdio:vscodeOptions': {
                extensionPath,
                storagePath,
                workspacePath: fixturePath,
                vscodeArgs: {
                    'disable-workspace-trust': true,
                    'logs-path': vscodeLogsDir,
                    // See `.vscode-test.mjs`.
                    ...(process.platform === 'linux' ? { 'ozone-platform': 'x11' } : {}),
                },
            },
        },
    ],
    logLevel: 'warn',
    framework: 'mocha',
    reporters: ['spec', ['junit', { outputDir, outputFileFormat: opts => `wdio-junit-${opts.cid}.xml` }]],
    mochaOpts: {
        ui: 'bdd',
        timeout: 15 * 60_000,
    },
    services: ['vscode'],
    // VS Code 1.118 and later opens a chat view in the secondary side bar. It
    // covers the InfoView and takes its clicks. No setting prevents this in all
    // versions, so we close the side bar before each test.
    async beforeTest() {
        await browser.executeWorkbench(async vscode => {
            await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
        })
    },
    // On failure, save a screenshot of the workbench.
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
}
