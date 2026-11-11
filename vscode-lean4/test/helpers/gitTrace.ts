import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTestWorkDir } from './testHome'

// If `GIT_TRACE2` is the absolute path of a folder, each git process writes a
// log (Git trace2, normal format) to a new file in the folder. The log shows
// the command line, the child processes and their exit codes, the messages of
// `die()`, and the exit code of the process.
//
// Lake does not tell how a git call failed. For example, it reports a failed
// `git fetch` only as "failed to fetch the package revision". On Windows, git
// can also stop without a message: then Lake shows no output of git at all.
// With the logs, a log without an `exit` line shows the process that stopped,
// and a missing log shows a process that did not start.
//
// The value must be a folder. With `1` or `2`, git writes the log to stdout or
// stderr, and Lake reads the stdout of some git calls.

// Makes a new folder for the logs. The next test run deletes it.
export function makeGitTraceDir(): string {
    return makeTestWorkDir('git-trace-')
}

// Returns the logs in `dir`, in the order in which the processes started.
export function readGitTrace(dir: string): string {
    let files: string[]
    try {
        // The file names start with the start time of the process (the trace2
        // session ID), so the alphabetical order is the start order.
        files = fs.readdirSync(dir).sort()
    } catch (e) {
        return `git trace: cannot read ${dir}: ${(e as Error).message}`
    }
    if (files.length === 0) {
        return `git trace: no git process wrote a log to ${dir}`
    }
    const logs = files.map(file => `--- ${file}\n${fs.readFileSync(path.join(dir, file), 'utf8').trimEnd()}`)
    return `git trace (${dir}):\n${logs.join('\n')}`
}

// Runs `fn` with `GIT_TRACE2` in `process.env`. The extension starts its
// processes with `process.env`, so its git calls (also through Lake) write
// logs. If `fn` fails, the error message gets the logs.
export async function withGitTrace<T>(fn: () => Promise<T>): Promise<T> {
    const dir = makeGitTraceDir()
    const previous = process.env.GIT_TRACE2
    process.env.GIT_TRACE2 = dir
    try {
        return await fn()
    } catch (e) {
        throw appendToError(e, readGitTrace(dir))
    } finally {
        if (previous === undefined) {
            delete process.env.GIT_TRACE2
        } else {
            process.env.GIT_TRACE2 = previous
        }
    }
}

// Adds `text` to the message of `e`. The stack starts with the message, and
// mocha and the state dump (`teardown.ts`) print the stack, so we change the
// message in the stack too. We keep the error object: mocha shows the diff of
// an `AssertionError`.
function appendToError(e: unknown, text: string): unknown {
    if (!(e instanceof Error)) {
        return new Error(`${String(e)}\n${text}`)
    }
    const message = e.message
    e.message = `${message}\n${text}`
    if (e.stack !== undefined) {
        // A function as the replacement, so that `$` in the logs is not a pattern.
        e.stack =
            message !== '' && e.stack.includes(message)
                ? e.stack.replace(message, () => e.message)
                : `${e.stack}\n${text}`
    }
    return e
}
