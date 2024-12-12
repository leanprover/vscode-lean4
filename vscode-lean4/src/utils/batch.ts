import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { OutputChannel, Progress, ProgressLocation, ProgressOptions, window } from 'vscode'
import { logger } from './logger'
import { displayNotificationWithOutput } from './notifs'

export interface ExecutionChannel {
    combined?: OutputChannel | undefined
    stdout?: OutputChannel | undefined
    stderr?: OutputChannel | undefined
}

export enum ExecutionExitCode {
    Success,
    CannotLaunch,
    ExecutionError,
    Cancelled,
}

export interface ExecutionResult {
    exitCode: ExecutionExitCode
    stdout: string
    stderr: string
    combined: string
}

function createCannotLaunchExecutionResult(message: string): ExecutionResult {
    return {
        exitCode: ExecutionExitCode.CannotLaunch,
        stdout: message,
        stderr: '',
        combined: message,
    }
}

export function batchExecuteWithProc(
    executablePath: string,
    args: string[],
    workingDirectory?: string | undefined,
    channel?: ExecutionChannel | undefined,
    envExtensions?: { [key: string]: string } | undefined,
): [ChildProcessWithoutNullStreams | 'CannotLaunch', Promise<ExecutionResult>] {
    let stdout: string = ''
    let stderr: string = ''
    let combined: string = ''
    let options = {}
    if (workingDirectory !== undefined) {
        options = { cwd: workingDirectory }
    }
    if (envExtensions !== undefined) {
        const env = Object.assign({}, process.env)
        for (const [key, value] of Object.entries(envExtensions)) {
            env[key] = value
        }
        options = { ...options, env }
    }
    if (channel?.combined) {
        const formattedCwd = workingDirectory ? `${workingDirectory}` : ''
        const formattedArgs = args.map(arg => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')
        channel.combined.appendLine(`${formattedCwd}> ${executablePath} ${formattedArgs}`)
    }

    let proc: ChildProcessWithoutNullStreams
    try {
        proc = spawn(executablePath, args, options)
    } catch (e) {
        return ['CannotLaunch', new Promise(resolve => resolve(createCannotLaunchExecutionResult('')))]
    }

    const execPromise: Promise<ExecutionResult> = new Promise(resolve => {
        const conclude = (r: ExecutionResult) =>
            resolve({
                exitCode: r.exitCode,
                stdout: r.stdout.trim(),
                stderr: r.stderr.trim(),
                combined: r.combined.trim(),
            })

        proc.on('error', err => {
            conclude(createCannotLaunchExecutionResult(err.message))
        })

        proc.stdout.on('data', line => {
            const s: string = line.toString()
            if (channel?.combined) channel.combined.appendLine(s)
            if (channel?.stdout) channel.stdout.appendLine(s)
            stdout += s + '\n'
            combined += s + '\n'
        })

        proc.stderr.on('data', line => {
            const s: string = line.toString()
            if (channel?.combined) channel.combined.appendLine(s)
            if (channel?.stderr) channel.stderr.appendLine(s)
            stderr += s + '\n'
            combined += s + '\n'
        })

        proc.on('close', (code, signal) => {
            logger.log(`child process exited with code ${code}`)
            if (signal === 'SIGTERM') {
                if (channel?.combined) {
                    channel.combined.appendLine('=> Operation cancelled by user.')
                }
                conclude({
                    exitCode: ExecutionExitCode.Cancelled,
                    stdout,
                    stderr,
                    combined,
                })
                return
            }
            if (code !== 0) {
                if (channel?.combined) {
                    const formattedCode = code ? `Exit code: ${code}.` : ''
                    const formattedSignal = signal ? `Signal: ${signal}.` : ''
                    channel.combined.appendLine(`=> Operation failed. ${formattedCode} ${formattedSignal}`.trim())
                }
                conclude({
                    exitCode: ExecutionExitCode.ExecutionError,
                    stdout,
                    stderr,
                    combined,
                })
                return
            }
            conclude({
                exitCode: ExecutionExitCode.Success,
                stdout,
                stderr,
                combined,
            })
        })
    })

    return [proc, execPromise]
}

export async function batchExecute(
    executablePath: string,
    args: string[],
    workingDirectory?: string | undefined,
    channel?: ExecutionChannel | undefined,
    envExtensions?: { [key: string]: string } | undefined,
): Promise<ExecutionResult> {
    const [_, execPromise] = batchExecuteWithProc(executablePath, args, workingDirectory, channel, envExtensions)
    return execPromise
}

export interface ProgressExecutionOptions {
    cwd?: string | undefined
    channel?: OutputChannel | undefined
    translator?: ((line: string) => string | undefined) | undefined
    envExtensions?: { [key: string]: string } | undefined
    allowCancellation?: boolean
}

export async function batchExecuteWithProgress(
    executablePath: string,
    args: string[],
    context: string | undefined,
    title: string,
    options: ProgressExecutionOptions = {},
): Promise<ExecutionResult> {
    const titlePrefix = context ? `[${context}] ` : ''
    const titleSuffix = options.channel ? ' [(Click for details)](command:lean4.troubleshooting.showOutput)' : ''

    const progressOptions: ProgressOptions = {
        location: ProgressLocation.Notification,
        title: titlePrefix + title + titleSuffix,
        cancellable: options.allowCancellation === true,
    }

    let progress:
        | Progress<{
              message?: string | undefined
              increment?: number | undefined
          }>
        | undefined

    const progressChannel: OutputChannel = {
        name: 'ProgressChannel',
        append(value: string) {
            if (options.translator) {
                const translatedValue: string | undefined = options.translator(value)
                if (translatedValue === undefined) {
                    return
                }
                value = translatedValue
            }
            if (options.channel) {
                options.channel.appendLine(value.trimEnd())
                progress?.report({ message: value })
            }
        },
        appendLine(value: string) {
            this.append(value + '\n')
        },
        replace(_: string) {
            /* empty */
        },
        clear() {
            /* empty */
        },
        show() {
            /* empty */
        },
        hide() {
            /* empty */
        },
        dispose() {
            /* empty */
        },
    }

    const expensiveExecutionTimeoutPromise: Promise<ExecutionResult | undefined> = new Promise((resolve, _) =>
        setTimeout(() => resolve(undefined), 250),
    )
    const [proc, executionPromise] = batchExecuteWithProc(
        executablePath,
        args,
        options.cwd,
        {
            combined: progressChannel,
        },
        options.envExtensions,
    )
    if (proc === 'CannotLaunch') {
        return executionPromise // resolves to a 'CannotLaunch' ExecutionResult
    }

    const preliminaryResult = await Promise.race([expensiveExecutionTimeoutPromise, executionPromise])
    if (preliminaryResult !== undefined) {
        return preliminaryResult
    }

    // Execution already took longer than 250ms, let's start displaying a progress bar now
    const result: ExecutionResult = await window.withProgress(progressOptions, (p, token) => {
        progress = p
        token.onCancellationRequested(() => proc.kill())
        return executionPromise
    })
    return result
}

type ExecutionHandler = () => Promise<ExecutionResult>

export interface BatchExecution {
    execute: ExecutionHandler
    optional?: boolean | undefined // `false` by default
}

export async function executeAll(executions: BatchExecution[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = []
    for (const execution of executions) {
        const result: ExecutionResult = await execution.execute()
        results.push(result)
        if (execution.optional !== true && result.exitCode !== ExecutionExitCode.Success) {
            break
        }
    }
    return results
}

export function displayResultError(result: ExecutionResult, message: string) {
    if (result.exitCode === ExecutionExitCode.Success) {
        throw Error()
    }
    const errorMessage: string = formatErrorMessage(result, message)
    displayNotificationWithOutput('Error', errorMessage)
}

function formatErrorMessage(error: ExecutionResult, message: string): string {
    if (error.combined === '') {
        return `${message}`
    }
    return `${message} Command output: ${error.combined}`
}
