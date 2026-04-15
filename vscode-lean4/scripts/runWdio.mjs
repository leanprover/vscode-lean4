import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exitLike, runChild, stoppedBy } from './childProcess.mjs'
import { prepareTestHome } from './testHome.mjs'
import { resolveVSCodeVersions } from './vscodeVersions.mjs'

// Runs `wdio run ./wdio.conf.mjs`. Before that, it does the one-time work of a
// run. `wdio.conf.mjs` does not do this, because wdio loads the configuration
// in each process, and the launcher opens its log files in `wdio-output/`
// before the `onPrepare` hook runs.

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The same options as `test/helpers/fs.ts`.
const rmOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }

prepareTestHome()

// The output of the last run, and the VS Code user data of the last run.
// `wdio.conf.mjs` explains the folders.
fs.rmSync(path.join(extensionPath, 'wdio-output'), rmOptions)
fs.rmSync(path.join(extensionPath, '.wdio-vscode-service', 'storage', 'settings'), rmOptions)

// wdio-vscode-service maps `stable` to the version that it downloaded first,
// and never looks for a newer one. Thus we give it the current stable version
// (`vscodeVersions.mjs` explains the choice). If we cannot get it (for example
// offline), we let it use its cached version.
if (process.env.LEAN4_WDIO_VSCODE_VERSION === undefined) {
    try {
        process.env.LEAN4_WDIO_VSCODE_VERSION = (await resolveVSCodeVersions()).wdio
    } catch (e) {
        console.warn(`[wdio] cannot get the current VS Code stable version, using the cached one: ${e}`)
        process.env.LEAN4_WDIO_VSCODE_VERSION = 'stable'
    }
}

// The handler of `childProcess.mjs` sees a SIGINT from the setup (for example
// during `elan toolchain install`) only when the event loop runs. After a stop,
// we do not start wdio.
await new Promise(resolve => setImmediate(resolve))
if (stoppedBy()) {
    exitLike({ status: 1, signal: null })
} else {
    // On Windows, `wdio` is a `.cmd` file, which needs a shell.
    exitLike(
        await runChild('wdio', ['run', './wdio.conf.mjs'], {
            cwd: extensionPath,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        }),
    )
}
