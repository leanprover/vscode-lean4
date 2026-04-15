#!/usr/bin/env node
// Cross-platform `test:headless*` wrapper.
//
// On Linux, VS Code test instances opened by `vscode-test` and wdio
// rendered through the developer's real X / Wayland session steal focus
// for the duration of the suite. We solve this with `xvfb-run -a`, which
// allocates a virtual X display and routes the test instances through it.
//
// On Windows and macOS there is no equivalent focus-stealing problem on
// CI runners (no display server) and no equivalent of xvfb in the
// upstream toolchain. Running the inner command directly gives the same
// observable behavior. So `npm run test:headless*` becomes:
//   - Linux:        xvfb-run -a <command…>
//   - Windows/mac:  <command…>
//
// Keeping the npm-script invocation identical across OSes means CI
// workflows and local docs don't have to platform-branch.
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length === 0) {
    console.error('usage: headless.mjs <command> [args...]')
    process.exit(2)
}

const useXvfb = process.platform === 'linux'
const cmd = useXvfb ? 'xvfb-run' : args[0]
const cmdArgs = useXvfb ? ['-a', ...args] : args.slice(1)

// `shell: true` lets npm's `.cmd` shim resolve on Windows when the inner
// command is `npm`. On Linux this is harmless — the command path is
// looked up via the shell's PATH search, identical to the bare-spawn
// behavior.
const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: true })
child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal)
    } else {
        process.exit(code ?? 1)
    }
})
