import { OutputChannel } from 'vscode'
import { displayOutputError, ExecutionExitCode, ExecutionResult } from './batch'
import { FileUri } from './exturi'
import { leanRunner, ToolchainUpdateMode } from './leanCmdRunner'

export type LakeRunnerOptions = {
    channel: OutputChannel
    cwdUri: FileUri | undefined
    context: string | undefined
    toolchain?: string | undefined
    toolchainUpdateMode: ToolchainUpdateMode
}

export type TryFetchMathlibCacheResult = { kind: 'Success' } | { kind: 'Error'; output: string } | { kind: 'Cancelled' }

export type FetchMathlibCacheResult =
    // Invariant: `result.exitCode !== ExecutionExitCode.Cancelled`
    // since this exit code always gets mapped to `{ kind: 'Cancelled' }`.
    { kind: 'CacheAvailable'; result: ExecutionResult } | { kind: 'CacheUnavailable' } | { kind: 'Cancelled' }

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

    private async runFetchMathlibCacheCommand(args: string[], prompt: string): Promise<FetchMathlibCacheResult> {
        const availability = await this.isMathlibCacheGetAvailable()
        if (availability === 'Cancelled') {
            return { kind: 'Cancelled' }
        }
        if (availability === 'Unavailable') {
            return { kind: 'CacheUnavailable' }
        }
        const result = await this.runLakeCommandWithProgress('exe', ['cache', 'get'].concat(args), prompt)
        if (result.exitCode === ExecutionExitCode.Cancelled) {
            return { kind: 'Cancelled' }
        }
        return { kind: 'CacheAvailable', result }
    }

    private async tryRunFetchMathlibCacheCommand(args: string[], prompt: string): Promise<TryFetchMathlibCacheResult> {
        const fetchResult = await this.runFetchMathlibCacheCommand(args, prompt)
        if (fetchResult.kind === 'Cancelled') {
            return { kind: 'Cancelled' }
        }
        if (fetchResult.kind === 'CacheUnavailable') {
            return { kind: 'Success' }
        }
        if (fetchResult.result.exitCode === ExecutionExitCode.Cancelled) {
            return { kind: 'Cancelled' }
        }
        if (fetchResult.result.exitCode !== ExecutionExitCode.Success) {
            return { kind: 'Error', output: fetchResult.result.combined }
        }
        return { kind: 'Success' }
    }

    async fetchMathlibCache(): Promise<FetchMathlibCacheResult> {
        return this.runFetchMathlibCacheCommand([], 'Fetching Mathlib build artifact cache')
    }

    async tryFetchMathlibCache(): Promise<TryFetchMathlibCacheResult> {
        return this.tryRunFetchMathlibCacheCommand([], 'Fetching Mathlib build artifact cache')
    }

    async tryFetchMathlibCacheWithError(): Promise<'Success' | 'Failure'> {
        const fetchResult = await this.tryFetchMathlibCache()
        if (fetchResult.kind === 'Cancelled') {
            return 'Failure'
        }
        if (fetchResult.kind !== 'Success') {
            displayOutputError(fetchResult.output, 'Cannot fetch Mathlib build artifact cache.')
            return 'Failure'
        }
        return 'Success'
    }

    async fetchMathlibCacheForFile(projectRelativeFileUri: FileUri): Promise<FetchMathlibCacheResult> {
        return this.runFetchMathlibCacheCommand(
            [projectRelativeFileUri.fsPath],
            `Fetching Mathlib build artifact cache for ${projectRelativeFileUri.baseName()}`,
        )
    }

    async isMathlibCacheGetAvailable(): Promise<'Available' | 'Unavailable' | 'Cancelled'> {
        const result: ExecutionResult = await this.runLakeCommandWithProgress(
            'exe',
            ['cache'],
            'Checking whether this is a Mathlib project',
            // Filter the `lake exe cache` help string.
            _line => undefined,
        )
        if (result.exitCode === ExecutionExitCode.Cancelled) {
            return 'Cancelled'
        }
        if (result.exitCode === ExecutionExitCode.Success) {
            return 'Available'
        }
        return 'Unavailable'
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
