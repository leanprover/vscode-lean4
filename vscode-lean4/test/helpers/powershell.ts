import { execFile, execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Runs Windows PowerShell in the same state as `src/utils/batch.ts`: with its
// full path, without the profiles of the user, and without `PSModulePath`. In
// CI, the step shell `pwsh` sets `PSModulePath` to the module folders of
// PowerShell 7, and Windows PowerShell then cannot load its own modules
// (`withoutPSModulePath` in `src/utils/envPath.ts` explains this).
function windowsPowerShellCommand(args: string[]): { exe: string; args: string[]; env: NodeJS.ProcessEnv } {
    const exe = path.win32.join(
        process.env.windir || process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
    )
    // The names of environment variables on Windows are case-insensitive.
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
    )
    return { exe, args: ['-NoProfile', '-NonInteractive', ...args], env }
}

// Runs Windows PowerShell with `args` (see `windowsPowerShellCommand`), and
// returns the standard output.
export function windowsPowerShell(args: string[]): string {
    const command = windowsPowerShellCommand(args)
    return execFileSync(command.exe, command.args, {
        env: command.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    })
}

// `-EncodedCommand` prevents quoting problems.
function encodedCommandArgs(script: string): string[] {
    return ['-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}

// Runs the PowerShell script `script` with `windowsPowerShell`, and returns the
// standard output.
export function windowsPowerShellScript(script: string): string {
    return windowsPowerShell(encodedCommandArgs(script))
}

// Like `windowsPowerShellScript`, but it does not block the extension host:
// use it for scripts that take minutes (`lake.ts` explains this). Stops
// PowerShell after `timeoutMs`. Fails with stdout and stderr in the message.
export async function windowsPowerShellScriptAsync(script: string, timeoutMs: number): Promise<string> {
    const command = windowsPowerShellCommand(encodedCommandArgs(script))
    try {
        const { stdout } = await execFileAsync(command.exe, command.args, {
            env: command.env,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            timeout: timeoutMs,
        })
        return stdout
    } catch (e) {
        const err = e as Error & { code?: number | string; killed?: boolean; stdout?: string; stderr?: string }
        // The message of `execFile` contains the encoded script, so we do not use it.
        const reason = err.killed ? `stopped after ${timeoutMs} ms` : `failed (${err.code ?? err.message})`
        throw new Error(
            `Windows PowerShell script ${reason}\nstdout:\n${err.stdout ?? ''}\nstderr:\n${err.stderr ?? ''}`,
        )
    }
}

// Returns `s` as a PowerShell string literal in single quotes.
export function psSingleQuote(s: string): string {
    return `'${s.replace(/'/g, "''")}'`
}
