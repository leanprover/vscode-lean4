import path from 'path'
import { OutputChannel } from 'vscode'
import { ExecutionExitCode, ExecutionResult } from './batch'
import { FileUri } from './exturi'
import { leanRunner, ToolchainUpdateMode } from './leanCmdRunner'

export const cacheNotFoundError = 'unknown executable `cache`'
export const cacheNotFoundExitError = '=> Operation failed. Exit Code: 1.'

export type LakeRunnerOptions = {
    channel: OutputChannel
    cwdUri: FileUri | undefined
    context: string | undefined
    toolchain?: string | undefined
    toolchainUpdateMode: ToolchainUpdateMode
}

export class LakeRunner {
    constructor(readonly options: LakeRunnerOptions) {}

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

    private async runLakeCommandWithProgress(
        subCommand: string,
        args: string[],
        waitingPrompt: string,
        translator?: ((line: string) => string | undefined) | undefined,
    ): Promise<ExecutionResult> {
        return await leanRunner.runLeanCommand('lake', [subCommand, ...args], {
            channel: this.options.channel,
            context: this.options.context,
            cwdUri: this.options.cwdUri,
            waitingPrompt,
            toolchain: this.options.toolchain,
            toolchainUpdateMode: this.options.toolchainUpdateMode,
            translator,
        })
    }
}

export function lake(options: LakeRunnerOptions): LakeRunner {
    return new LakeRunner(options)
}
