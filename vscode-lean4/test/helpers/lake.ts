import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { makeGitTraceDir, readGitTrace } from './gitTrace'

const execFileAsync = promisify(execFile)

// Runs `lake ...args` in `cwd` and returns its stdout. `execFile`, not
// `execFileSync`: a build or a download takes minutes, and a synchronous call
// blocks the extension host for that time. Stops lake after `timeoutMs`. Fails
// with stdout and stderr in the message: Lake writes most errors to stdout.
// The message also has the logs of the git calls of Lake (`gitTrace.ts`):
// Lake does not tell how a git call failed.
export async function lake(cwd: string, args: string[], timeoutMs: number): Promise<string> {
    const traceDir = makeGitTraceDir()
    try {
        const { stdout } = await execFileAsync('lake', args, {
            cwd,
            env: { ...process.env, GIT_TRACE2: traceDir },
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            timeout: timeoutMs,
        })
        return stdout
    } catch (e) {
        const err = e as ExecError
        throw new Error(
            `\`lake ${args.join(' ')}\` failed in ${cwd}: ${describeFailure(err, timeoutMs)}\n` +
                `stdout:\n${err.stdout ?? ''}\nstderr:\n${err.stderr ?? ''}\n${readGitTrace(traceDir)}`,
        )
    }
}

// The error of `execFile`. `code` is the exit code, or a string if lake did not start.
type ExecError = Error & {
    code?: number | string | null
    signal?: string | null
    killed?: boolean
    stdout?: string
    stderr?: string
}

function describeFailure(err: ExecError, timeoutMs: number): string {
    if (typeof err.code === 'string') {
        return err.message
    }
    if (err.killed) {
        return `stopped after the timeout of ${timeoutMs} ms (${err.signal})`
    }
    if (err.signal) {
        return `stopped by ${err.signal}`
    }
    // On Windows, a crash gives an NTSTATUS code, for example 0xC0000005.
    const code = err.code ?? 'unknown'
    return typeof code === 'number' && code > 255
        ? `exit code ${code} (0x${code.toString(16).toUpperCase()})`
        : `exit code ${code}`
}
