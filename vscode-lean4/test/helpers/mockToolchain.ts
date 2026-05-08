import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { rmSync } from './fs'
import { requireIsolatedTestHome } from './testHome'

// Compiles a tiny .NET console application that prints `output` and exits.
// Used on Windows because `elan toolchain link` validates that the linked
// directory contains real `bin\<tool>.exe` PE binaries — a `.cmd` shim
// doesn't satisfy the existence check, and elan's invocation path goes
// through the `.exe` entry regardless. PowerShell's `Add-Type` invokes
// the C# compiler (`csc`) bundled with the .NET SDK, which is preinstalled
// on GitHub-hosted Windows runners. Local Windows devs need .NET on PATH;
// it usually is (Visual Studio, Windows SDK, .NET SDK installer).
//
// Encoded command bypasses outer-shell quoting: PS reads UTF-16LE base64
// from `-EncodedCommand`. Inside, the C# source is embedded via
// `JSON.stringify` (whose escape rules are a subset of valid C# string
// literal syntax — `\n`, `\\`, `\"`, `\uXXXX`, surrogate pairs all work
// the same). The output assembly path is single-quoted with `'`-doubling
// to be safe against unusual paths.
function compileWindowsStub(exePath: string, output: string): void {
    const psSingleQuote = (s: string) => `'${s.replace(/'/g, "''")}'`
    const csSource = `using System;
class Program {
    static void Main() { Console.WriteLine(${JSON.stringify(output)}); }
}`
    const psScript = `$ErrorActionPreference = 'Stop'
Add-Type -OutputType ConsoleApplication -OutputAssembly ${psSingleQuote(exePath)} -TypeDefinition @'
${csSource}
'@`
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
}

// Creates a fake elan toolchain registered in the isolated test ELAN_HOME.
// `name` becomes the toolchain identifier — what callers put in a
// `lean-toolchain` file to make the project use this fake. The script form
// of `bin/lean` (and `bin/lake`) lets tests drive paths in the diagnoser
// (e.g. Lean 3 / pre-stable Lean 4 detection) without installing a real
// toolchain.
//
// POSIX: `#!/bin/sh` shebang scripts chmod'd 755.
// Windows: real PE binaries compiled at runtime — see `compileWindowsStub`.
// The two flavors print the same version string so tests stay
// platform-agnostic.
//
// Internal — tests should use `withMockToolchain` so the link is cleaned up
// when the test concludes (otherwise the link leaks into the CI elan cache,
// surviving across runs and breaking subsequent jobs).
function createMockToolchain(
    name: string,
    { leanVersion, lakeVersion = 'Lake version 5.0.0' }: { leanVersion: string; lakeVersion?: string },
): string {
    const { testHome, elanHome } = requireIsolatedTestHome({ requireElanHome: true })
    const toolchainDir = path.join(testHome, 'mock-toolchains', name)
    const binDir = path.join(toolchainDir, 'bin')
    fs.mkdirSync(binDir, { recursive: true })

    const writeScript = (scriptName: string, output: string) => {
        if (process.platform === 'win32') {
            compileWindowsStub(path.join(binDir, `${scriptName}.exe`), output)
        } else {
            // Single-quote the output and escape any embedded `'` for `sh`.
            const escaped = output.replace(/'/g, "'\\''")
            const file = path.join(binDir, scriptName)
            fs.writeFileSync(file, `#!/bin/sh\necho '${escaped}'\n`)
            fs.chmodSync(file, 0o755)
        }
    }
    writeScript('lean', leanVersion)
    writeScript('lake', lakeVersion)

    // `elan toolchain link` errors with "already installed" if `<elanHome>/
    // toolchains/<name>` exists. Three reasons it might:
    //   - Prior test in the same run linked the same name (ELAN_HOME persists
    //     across tests in a suite).
    //   - CI cache restore: on Windows, `actions/cache@v4` does not preserve
    //     directory junctions across pack/unpack, so a previously-linked
    //     toolchain comes back as a real directory that elan still recognizes
    //     as an installed toolchain.
    //   - Anything else that wrote into that path.
    // For link-style toolchains, the directory under `<elanHome>/toolchains/
    // <name>` is the entire state — there's no separate metadata file to keep
    // in sync — so removing the directory directly is equivalent to (and more
    // reliable than) `elan toolchain uninstall`. The latter happens to fail
    // silently on the cache-restore case described above.
    rmSync(path.join(elanHome, 'toolchains', name))
    execFileSync('elan', ['toolchain', 'link', name, toolchainDir], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    return toolchainDir
}

// Removes both the link entry under `<elanHome>/toolchains/<name>` and the
// stub directory under `<testHome>/mock-toolchains/<name>`. The shared
// `rmSync` helper applies `force: true` so it's a no-op when either is
// already gone (crash path where the link was never created), and the
// retry policy that paper over the Windows PE-image / Defender file-lock
// race against the just-executed `lean.exe` stub.
function removeMockToolchain(name: string): void {
    const { testHome, elanHome } = requireIsolatedTestHome({ requireElanHome: true })
    rmSync(path.join(elanHome, 'toolchains', name))
    rmSync(path.join(testHome, 'mock-toolchains', name))
}

// Scoped wrapper: link a mock toolchain, run the body, unlink in `finally`.
// Use this rather than calling `createMockToolchain` directly — see the
// comment on `createMockToolchain` for the leak rationale. The pre-link
// `rmSync` inside `createMockToolchain` still earns its keep as the
// crash-path safety net (a previous run killed mid-test would leave a stale
// link that this run cleans up before relinking).
export async function withMockToolchain<T>(
    name: string,
    opts: { leanVersion: string; lakeVersion?: string },
    body: () => Promise<T>,
): Promise<T> {
    createMockToolchain(name, opts)
    try {
        return await body()
    } finally {
        removeMockToolchain(name)
    }
}
