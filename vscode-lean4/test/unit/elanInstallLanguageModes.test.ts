import { execFile, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withoutPSModulePath } from '../../src/utils/envPath'

// On computers with AppLocker or WDAC, PowerShell can run in
// ConstrainedLanguage mode. This mode permits method calls only on a small set
// of types. `scripts/elan-install/install-windows.ps1` must also install Elan
// in this mode (`scripts/installation-scripts.md`).
//
// This test runs the script in the two language modes. A local server gives a
// stub for `elan-init.ps1`, so the test installs nothing and can run on all
// platforms. The stub has the same structure as `elan-init.ps1`: a help
// comment, a `param` block, and a `return` with the exit code.
//
// The test runs the script with PowerShell 7 (`pwsh`) on all platforms. On
// Windows, it also runs the script with Windows PowerShell, which the
// extension uses. A session of these programs can set its own language mode to
// ConstrainedLanguage. If a program is not available, vitest skips its tests.
// The GitHub-hosted runners have `pwsh`.

type Shell = { name: string; exe: string; env: NodeJS.ProcessEnv; available: boolean }

const shellArgs = ['-NoProfile', '-NonInteractive']

// `withoutPSModulePath` explains why Windows PowerShell must not get
// `PSModulePath`. The path is the path of `getPowerShellPath` in
// `src/config.ts`.
const shells: Shell[] = [
    {
        name: 'PowerShell 7',
        exe: 'pwsh',
        env: process.env,
        available: spawnSync('pwsh', [...shellArgs, '-Command', 'exit 0']).status === 0,
    },
    {
        name: 'Windows PowerShell',
        exe: path.win32.join(
            process.env.windir || process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
        ),
        env: withoutPSModulePath(process.env),
        available: process.platform === 'win32',
    },
]

const elanInitUrl = 'https://elan.lean-lang.org/elan-init.ps1'

// Characters that UTF-8 encodes with 2, 3 and 4 bytes. The stub contains them,
// and the script must decode them correctly in the two language modes.
const nonAsciiText = '\u{e9}\u{2713}\u{1f600}'
// The UTF-16 codes of `nonAsciiText`. The stub writes the codes and not the
// characters, so that the output encoding of the shell has no effect on the
// test.
const nonAsciiCodes = Array.from({ length: nonAsciiText.length }, (_, i) => nonAsciiText.charCodeAt(i)).join(',')

// The stub writes its language mode and its arguments to the host. It also
// writes a second object to the pipeline before the exit code: the script must
// use only the last object.
function elanInitStub(exitCode: number): string {
    return [
        '<#',
        '.SYNOPSIS',
        '    A stub for `elan-init.ps1`.',
        '#>',
        'param(',
        '    [bool] $NoPrompt = 0,',
        '    [string] $DefaultToolchain = ""',
        ')',
        'Write-Host "stub: mode=$($ExecutionContext.SessionState.LanguageMode) NoPrompt=$NoPrompt DefaultToolchain=$DefaultToolchain"',
        `Write-Host "stub: codes=$([int[]][char[]]'${nonAsciiText}' -join ',')"`,
        '"an output that is not the exit code"',
        `return ${exitCode}`,
        '',
    ].join('\n')
}

describe('scripts/elan-install/install-windows.ps1', () => {
    const extensionDir = path.join(__dirname, '..', '..')
    const installScript = fs.readFileSync(
        path.join(extensionDir, 'scripts', 'elan-install', 'install-windows.ps1'),
        'utf8',
    )
    const toolchain = /-DefaultToolchain (\S+)/.exec(installScript)?.[1]

    // `/0/elan-init.ps1` gives a stub that returns 0, `/1/elan-init.ps1` gives
    // a stub that returns 1. The content type is the content type of
    // `elanInitUrl`. With this type, `Invoke-WebRequest` gives the content as
    // bytes.
    let server: http.Server
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
            res.end(elanInitStub(req.url?.startsWith('/0/') ? 0 : 1))
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    })
    afterAll(async () => {
        await new Promise(resolve => server.close(resolve))
    })

    // Runs the install script with `shell` in the language mode `mode`, with
    // the stub that returns `stubExitCode`. `-EncodedCommand` prevents quoting
    // problems. With it, PowerShell writes errors as XML, unless the output
    // format is `Text`. `spawnSync` cannot be used here, because it blocks the
    // server.
    function runInstallScript(
        shell: Shell,
        mode: string,
        stubExitCode: number,
    ): Promise<{ exitCode: number; output: string }> {
        expect(installScript).toContain(elanInitUrl)
        const { port } = server.address() as AddressInfo
        const script = installScript.replace(elanInitUrl, `http://127.0.0.1:${port}/${stubExitCode}/elan-init.ps1`)
        const command = `$ExecutionContext.SessionState.LanguageMode = '${mode}'\n${script}`
        const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
        return new Promise(resolve => {
            const args = [...shellArgs, '-OutputFormat', 'Text', '-EncodedCommand', encodedCommand]
            execFile(shell.exe, args, { env: shell.env }, (error, stdout, stderr) => {
                const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
                resolve({ exitCode, output: stdout + stderr })
            })
        })
    }

    const modes = ['FullLanguage', 'ConstrainedLanguage']
    const timeoutMs = 60_000

    for (const shell of shells) {
        describe.skipIf(!shell.available)(`with ${shell.name}`, () => {
            it.each(modes)(
                'runs the Elan installer in %s mode',
                async mode => {
                    const { exitCode, output } = await runInstallScript(shell, mode, 0)
                    expect(output).toContain(`stub: mode=${mode} NoPrompt=True DefaultToolchain=${toolchain}`)
                    // The lines of the output end with `\r\n` on Windows.
                    expect(output.split(/\r?\n/)).toContain(`stub: codes=${nonAsciiCodes}`)
                    expect(exitCode, output).toBe(0)
                },
                timeoutMs,
            )

            it.each(modes)(
                'fails in %s mode when the Elan installer fails',
                async mode => {
                    const { exitCode, output } = await runInstallScript(shell, mode, 1)
                    expect(output).toContain(`stub: mode=${mode} NoPrompt=True DefaultToolchain=${toolchain}`)
                    expect(exitCode, output).toBe(1)
                },
                timeoutMs,
            )
        })
    }
})
