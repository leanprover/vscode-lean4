import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { requireIsolatedTestHome } from './testHome'

// Creates a fake elan toolchain registered in the isolated test ELAN_HOME.
// `name` becomes the toolchain identifier — what callers put in a
// `lean-toolchain` file to make the project use this fake. The script form
// of `bin/lean` (and `bin/lake`) lets tests drive paths in the diagnoser
// (e.g. Lean 3 / pre-stable Lean 4 detection) without installing a real
// toolchain.
//
// Linux/macOS only: scripts use a `#!/bin/sh` shebang. The vscode-test-cli
// suite runs on Linux per the CI matrix; if Windows ever needs this, swap
// the scripts for `.cmd` / `.ps1` bodies on `process.platform === 'win32'`.
export function createMockToolchain(
    name: string,
    { leanVersion, lakeVersion = 'Lake version 5.0.0' }: { leanVersion: string; lakeVersion?: string },
): string {
    const { testHome } = requireIsolatedTestHome({ requireElanHome: true })
    const toolchainDir = path.join(testHome, 'mock-toolchains', name)
    const binDir = path.join(toolchainDir, 'bin')
    fs.mkdirSync(binDir, { recursive: true })

    const writeScript = (scriptName: string, output: string) => {
        const file = path.join(binDir, scriptName)
        // Single-quote the output and escape any embedded `'` for `sh`.
        const escaped = output.replace(/'/g, "'\\''")
        fs.writeFileSync(file, `#!/bin/sh\necho '${escaped}'\n`)
        fs.chmodSync(file, 0o755)
    }
    writeScript('lean', leanVersion)
    writeScript('lake', lakeVersion)

    // `elan toolchain link` would error if the name is already taken (e.g.
    // from a prior test in the same run, since ELAN_HOME persists across
    // tests in a suite). Uninstall first, ignoring "not installed" errors.
    try {
        execFileSync('elan', ['toolchain', 'uninstall', name], {
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    } catch {
        // ignore
    }
    execFileSync('elan', ['toolchain', 'link', name, toolchainDir], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    return toolchainDir
}
