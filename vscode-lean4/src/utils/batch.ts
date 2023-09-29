import { OutputChannel, ProgressLocation, ProgressOptions, window } from 'vscode'
import { spawn } from 'child_process';
import { findProgramInPath, isRunningTest } from '../config'
import { logger } from './logger'

export interface ExecutionChannel {
    combined?: OutputChannel | undefined
    stdout?: OutputChannel | undefined
    stderr?: OutputChannel | undefined
}

export enum ExecutionExitCode {
    Success,
    CannotLaunch,
    ExecutionError
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
    channel?: ExecutionChannel | undefined): Promise<ExecutionResult> {

    return new Promise(function(resolve, reject) {
        let stdout: string = ''
        let stderr: string = ''
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }

        try {
            if (isRunningTest())
            {
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
            const proc = spawn(executablePath, args, options);

            proc.on('error', err => {
                resolve(createCannotLaunchExecutionResult(err.message))
            });

            proc.stdout.on('data', (line) => {
                const s: string = line.toString();
                if (channel && channel.combined) channel.combined.appendLine(s)
                if (channel && channel.stdout) channel.stdout.appendLine(s)
                stdout += s + '\n';
            });

            proc.stderr.on('data', (line) => {
                const s: string = line.toString();
                if (channel && channel.combined) channel.combined.appendLine(s)
                if (channel && channel.stderr) channel.stderr.appendLine(s)
                stderr += s + '\n';
            });

            proc.on('close', (code) => {
                logger.log(`child process exited with code ${code}`);
                if (code !== 0) {
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

        } catch (e){
            logger.log(`error running ${executablePath} : ${e}`);
            resolve(createCannotLaunchExecutionResult(''));
        }
    });
}

export async function batchExecuteWithProgress(
    executablePath: string,
    args: string[],
    prompt: string,
    workingDirectory?: string | undefined,
    channel?: OutputChannel | undefined,
    translator?: ((line: string) => string | undefined) | undefined): Promise<ExecutionResult> {

    const progressOptions: ProgressOptions = {
        location: ProgressLocation.Notification,
        title: '',
        cancellable: false
    }
    let inc = 0

    const result: ExecutionResult = await window.withProgress(progressOptions, progress => {
        const progressChannel: OutputChannel = {
            name : 'ProgressChannel',
            append(value: string) {
                if (translator) {
                    const translatedValue: string | undefined = translator(value)
                    if (translatedValue === undefined) {
                        return
                    }
                    value = translatedValue
                }
                if (channel) {
                    channel.appendLine(value)
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
        progress.report({ increment: 0, message: prompt });
        return batchExecute(executablePath, args, workingDirectory, { combined: progressChannel });
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

export async function displayError(result: ExecutionResult, message: string, modal: boolean = false) {
    if (result.exitCode === ExecutionExitCode.Success) {
        throw Error()
    }
    const errorMessage: string = formatErrorMessage(result, message)
    await window.showErrorMessage(errorMessage, { modal })
}

function formatErrorMessage(error: ExecutionResult, message: string): string {
    if (error.stderr === '') {
        return `${message}`
    }
    return `${message}

Command error output:
${error.stderr}`
}
