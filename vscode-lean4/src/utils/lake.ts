import path from 'path'
import { OutputChannel } from 'vscode'
import { batchExecute, batchExecuteWithProgress, ExecutionExitCode, ExecutionResult } from './batch'
import { FileUri } from './exturi'

export const cacheNotFoundError = 'unknown executable `cache`'
export const cacheNotFoundExitError = '=> Operation failed. Exit Code: 1.'

export class LakeRunner {
    channel: OutputChannel
    cwdUri: FileUri | undefined
    toolchain: string | undefined

    constructor(channel: OutputChannel, cwdUri: FileUri | undefined, toolchain?: string | undefined) {
        this.channel = channel
        this.cwdUri = cwdUri
        this.toolchain = toolchain
    }

    async initProject(name: string, kind?: string | undefined): Promise<ExecutionResult> {
        const args = kind ? [name, kind] : [name]
        return this.runLakeCommandWithProgress('init', args, 'Initializing project')
    }

    async updateDependencies(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('update', [], 'Updating dependencies')
    }

    async updateDependency(dependencyName: string): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('update', [dependencyName], `Updating '${dependencyName}' dependency`)
    }

    async build(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('build', [], 'Building Lean project')
    }

    async clean(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('clean', [], 'Cleaning Lean project')
    }

    async fetchMathlibCache(filterError: boolean = false): Promise<ExecutionResult> {
        const prompt = 'Checking Mathlib build artifact cache'
        return this.runLakeCommandWithProgress('exe', ['cache', 'get'], prompt, line => {
            if (filterError && line.includes(cacheNotFoundError)) {
                return undefined
            }
            return line
        })
    }

    async fetchMathlibCacheForFile(projectRelativeFileUri: FileUri): Promise<ExecutionResult> {
        const prompt = `Fetching Mathlib build artifact cache for ${path.basename(projectRelativeFileUri.fsPath)}`
        return this.runLakeCommandWithProgress('exe', ['cache', 'get', projectRelativeFileUri.fsPath], prompt)
    }

    async isMathlibCacheGetAvailable(): Promise<'Yes' | 'No' | 'Cancelled'> {
        const result: ExecutionResult = await this.runLakeCommandWithProgress(
            'exe',
            ['cache'],
            'Checking whether this is a Mathlib project',
        )
        if (result.exitCode === ExecutionExitCode.Cancelled) {
            return 'Cancelled'
        }
        if (result.exitCode === ExecutionExitCode.Success) {
            return 'Yes'
        }
        return 'No'
    }

    private async runLakeCommandSilently(subCommand: string, args: string[]): Promise<ExecutionResult> {
        args = args.slice()
        args.unshift(subCommand)
        if (this.toolchain) {
            args.unshift(`+${this.toolchain}`)
        }
        return await batchExecute('lake', args, this.cwdUri?.fsPath)
    }

    private async runLakeCommandWithProgress(
        subCommand: string,
        args: string[],
        waitingPrompt: string,
        translator?: ((line: string) => string | undefined) | undefined,
    ): Promise<ExecutionResult> {
        args = args.slice()
        args.unshift(subCommand)
        if (this.toolchain) {
            args.unshift(`+${this.toolchain}`)
        }
        return await batchExecuteWithProgress('lake', args, waitingPrompt, {
            cwd: this.cwdUri?.fsPath,
            channel: this.channel,
            translator,
            allowCancellation: true,
        })
    }
}

export function lake(channel: OutputChannel, cwdUri: FileUri | undefined, toolchain?: string | undefined): LakeRunner {
    return new LakeRunner(channel, cwdUri, toolchain)
}
