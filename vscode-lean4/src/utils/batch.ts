import { CancellationToken, Disposable, OutputChannel, ProgressLocation, ProgressOptions, window } from 'vscode'
import { spawn } from 'child_process';
import { findProgramInPath, isRunningTest } from '../config'
import { logger } from './logger'
import { displayErrorWithOutput } from './errors';

export interface ExecutionChannel {
    combined?: OutputChannel | undefined
    stdout?: OutputChannel | undefined
    stderr?: OutputChannel | undefined
}

export enum ExecutionExitCode {
    Success,
    CannotLaunch,
    ExecutionError,
    Cancelled
}

export interface ExecutionResult {
    exitCode: ExecutionExitCode
    stdout: string
    stderr: string
}

function createCannotLaunchExecutionResult(message: string): ExecutionResult {
    return {
        exitCode: ExecutionExitCode.CannotLaunch,
        stdout: '',
        stderr: message
    }
}

export async function batchExecute(
    executablePath: string,
    args: string[],
    workingDirectory?: string | undefined,
    channel?: ExecutionChannel | undefined,
    token?: CancellationToken | undefined): Promise<ExecutionResult> {

    return new Promise(function(resolve, reject) {
        let stdout: string = ''
        let stderr: string = ''
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }

        try {
            if (isRunningTest()) {
                // The mocha test framework listens to process.on('uncaughtException')
                // which is raised if spawn cannot find the command and the test automatically
                // fails with "Uncaught Error: spawn elan ENOENT".  Therefore we manually
                // check if the command exists so as not to trigger that exception.
                const fullPath = findProgramInPath(executablePath);
                if (!fullPath) {
                    resolve(createCannotLaunchExecutionResult(''));
                    return;
                }
            }
            if (channel?.combined) {
                const formattedCwd = workingDirectory ? `${workingDirectory}` : ''
                const formattedArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ')
                channel.combined.appendLine(`${formattedCwd}> ${executablePath} ${formattedArgs}`)
            }
            const proc = spawn(executablePath, args, options);

            const disposeKill: Disposable | undefined = token?.onCancellationRequested(_ => proc.kill())

            proc.on('error', err => {
                disposeKill?.dispose()
                resolve(createCannotLaunchExecutionResult(err.message))
            });

            proc.stdout.on('data', (line) => {
                const s: string = line.toString();
                if (channel?.combined) channel.combined.appendLine(s)
                if (channel?.stdout) channel.stdout.appendLine(s)
                stdout += s + '\n';
            });

            proc.stderr.on('data', (line) => {
                const s: string = line.toString();
                if (channel?.combined) channel.combined.appendLine(s)
                if (channel?.stderr) channel.stderr.appendLine(s)
                stderr += s + '\n';
            });

            proc.on('close', (code, signal) => {
                disposeKill?.dispose()
                logger.log(`child process exited with code ${code}`);
                if (signal === 'SIGTERM') {
                    if (channel?.combined) {
                        channel.combined.appendLine('=> Operation cancelled by user.')
                    }
                    resolve({
                        exitCode: ExecutionExitCode.Cancelled,
                        stdout,
                        stderr
                    })
                    return
                }
                if (code !== 0) {
                    if (channel?.combined) {
                        const formattedCode = code ? `Exit code: ${code}.` : ''
                        const formattedSignal = signal ? `Signal: ${signal}.` : ''
                        channel.combined.appendLine(`=> Operation failed. ${formattedCode} ${formattedSignal}`.trim())
                    }
                    resolve({
                        exitCode: ExecutionExitCode.ExecutionError,
                        stdout,
                        stderr
                    })
                    return
                }
                resolve({
                    exitCode: ExecutionExitCode.Success,
                    stdout,
                    stderr
                })
            });

        } catch (e) {
            logger.log(`error running ${executablePath} : ${e}`);
            resolve(createCannotLaunchExecutionResult(''));
        }
    });
}

interface ProgressExecutionOptions {
    cwd?: string | undefined
    channel?: OutputChannel | undefined
    translator?: ((line: string) => string | undefined) | undefined
    allowCancellation?: boolean
}

export async function batchExecuteWithProgress(
    executablePath: string,
    args: string[],
    title: string,
    options: ProgressExecutionOptions = {}): Promise<ExecutionResult> {

    const titleSuffix = options.channel ? ' [(Details)](command:lean4.troubleshooting.showOutput)' : ''

    const progressOptions: ProgressOptions = {
        location: ProgressLocation.Notification,
        title: title + titleSuffix,
        cancellable: options.allowCancellation === true
    }
    let inc = 0

    const result: ExecutionResult = await window.withProgress(progressOptions, (progress, token) => {
        const progressChannel: OutputChannel = {
            name : 'ProgressChannel',
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
                }
                if (inc < 90) {
                    inc += 2
                }
                progress.report({ increment: inc, message: value })
            },
            appendLine(value: string) {
                this.append(value + '\n')
            },
            replace(_: string) { /* empty */ },
            clear() { /* empty */ },
            show() { /* empty */ },
            hide() { /* empty */ },
            dispose() { /* empty */ }
        }
        progress.report({ increment: 0 })
        return batchExecute(executablePath, args, options.cwd, { combined: progressChannel }, token);
    });
    return result;
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

export async function displayError(result: ExecutionResult, message: string) {
    if (result.exitCode === ExecutionExitCode.Success) {
        throw Error()
    }
    const errorMessage: string = formatErrorMessage(result, message)
    await displayErrorWithOutput(errorMessage)
}

function formatErrorMessage(error: ExecutionResult, message: string): string {
    if (error.stderr === '') {
        return `${message}`
    }
    return `${message} Command error output: ${error.stderr}`
}
