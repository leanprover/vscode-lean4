import * as os from 'os'
import { OutputChannel } from 'vscode'
import { displayOutputError, ExecutionExitCode } from './batch'
import { FileUri } from './exturi'
import { leanRunner, ToolchainUpdateMode } from './leanCmdRunner'

export type LakeRunnerOptions = {
    channel: OutputChannel
    cwdUri: FileUri | undefined
    context: string | undefined
    toolchain?: string | undefined
    toolchainUpdateMode: ToolchainUpdateMode
}

export type LakeRunnerErrorDiagnosis =
    | { kind: 'WindowsFetchError'; details: string }
    | { kind: 'CommandNotFound'; details: string }
export type LakeRunnerError = { kind: 'Error'; diagnosis: LakeRunnerErrorDiagnosis | undefined; output: string }
export type LakeRunnerResult = { kind: 'Success' } | { kind: 'Cancelled' } | LakeRunnerError

export function displayLakeRunnerError(error: LakeRunnerError, message: string) {
    if (error.diagnosis === undefined) {
        displayOutputError(error.output, message)
        return
    }
    displayOutputError(error.output, `${message} ${error.diagnosis.details}`)
}

export type FetchMathlibCacheResult =
    | { kind: 'Success' }
    | { kind: 'CacheUnavailable' }
    | { kind: 'Cancelled' }
    | LakeRunnerError

export type CacheGetAvailabilityResult =
    | { kind: 'CacheAvailable' }
    | { kind: 'CacheUnavailable' }
    | { kind: 'Cancelled' }
    | LakeRunnerError

export class LakeRunner {
    constructor(readonly options: LakeRunnerOptions) {}

    async initProject(name: string, kind?: string | undefined): Promise<LakeRunnerResult> {
        const args = kind ? [name, kind] : [name]
        return this.runLakeCommandWithProgress('init', args, 'Initializing project')
    }

    async updateDependencies(): Promise<LakeRunnerResult> {
        return this.runLakeCommandWithProgress('update', [], 'Updating dependencies')
    }

    async updateDependency(dependencyName: string): Promise<LakeRunnerResult> {
        return this.runLakeCommandWithProgress('update', [dependencyName], `Updating '${dependencyName}' dependency`)
    }

    async build(): Promise<LakeRunnerResult> {
        return this.runLakeCommandWithProgress('build', [], 'Building Lean project')
    }

    async clean(): Promise<LakeRunnerResult> {
        return this.runLakeCommandWithProgress('clean', [], 'Cleaning Lean project')
    }

    private async runFetchMathlibCacheCommand(args: string[], prompt: string): Promise<FetchMathlibCacheResult> {
        const availabilityResult = await this.isMathlibCacheGetAvailable()
        if (availabilityResult.kind !== 'CacheAvailable') {
            return availabilityResult
        }
        return await this.runLakeCommandWithProgress('exe', ['cache', 'get'].concat(args), prompt)
    }

    private async tryRunFetchMathlibCacheCommand(args: string[], prompt: string): Promise<LakeRunnerResult> {
        const fetchResult = await this.runFetchMathlibCacheCommand(args, prompt)
        if (fetchResult.kind === 'CacheUnavailable') {
            return { kind: 'Success' }
        }
        return fetchResult
    }

    async fetchMathlibCache(): Promise<FetchMathlibCacheResult> {
        return this.runFetchMathlibCacheCommand([], 'Fetching Mathlib build artifact cache')
    }

    async tryFetchMathlibCache(): Promise<LakeRunnerResult> {
        return this.tryRunFetchMathlibCacheCommand([], 'Fetching Mathlib build artifact cache')
    }

    async tryFetchMathlibCacheWithError(): Promise<'Success' | 'Failure'> {
        const fetchResult = await this.tryFetchMathlibCache()
        if (fetchResult.kind === 'Cancelled') {
            return 'Failure'
        }
        if (fetchResult.kind !== 'Success') {
            displayLakeRunnerError(fetchResult, 'Cannot fetch Mathlib build artifact cache.')
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

    async isMathlibCacheGetAvailable(): Promise<CacheGetAvailabilityResult> {
        const result: LakeRunnerResult = await this.runLakeCommandWithProgress(
            'exe',
            ['cache'],
            'Checking whether this is a Mathlib project',
            // Filter the `lake exe cache` help string.
            _line => undefined,
        )
        switch (result.kind) {
            case 'Success':
                return { kind: 'CacheAvailable' }
            case 'Cancelled':
                return { kind: 'Cancelled' }
            case 'Error':
                if (result.diagnosis !== undefined) {
                    return result
                }
                return { kind: 'CacheUnavailable' }
        }
    }

    private async runLakeCommandWithProgress(
        subCommand: string,
        args: string[],
        waitingPrompt: string,
        translator?: ((line: string) => string | undefined) | undefined,
    ): Promise<LakeRunnerResult> {
        const r = await leanRunner.runLeanCommand('lake', [subCommand, ...args], {
            channel: this.options.channel,
            context: this.options.context,
            cwdUri: this.options.cwdUri,
            waitingPrompt,
            toolchain: this.options.toolchain,
            toolchainUpdateMode: this.options.toolchainUpdateMode,
            translator,
        })
        switch (r.exitCode) {
            case ExecutionExitCode.Success:
                return { kind: 'Success' }
            case ExecutionExitCode.CannotLaunch:
                return {
                    kind: 'Error',
                    diagnosis: { kind: 'CommandNotFound', details: "'lake' command was not found." },
                    output: r.combined,
                }
            case ExecutionExitCode.ExecutionError:
                let diagnosis: LakeRunnerErrorDiagnosis | undefined
                if (
                    os.platform() === 'win32' &&
                    (r.combined.includes('failed to fetch GitHub release') ||
                        r.combined.includes('failed to fetch Reservoir build'))
                ) {
                    diagnosis = {
                        kind: 'WindowsFetchError',
                        details:
                            'Lake could not fetch a build cache artifact. On Windows, this can sometimes occur when third-party antiviruses interfere with the secure connection through which Lake downloads build artifacts. Click [here](command:lean4.troubleshooting.showTroubleshootingGuide) for more details.',
                    }
                }
                return {
                    kind: 'Error',
                    diagnosis,
                    output: r.combined,
                }
            case ExecutionExitCode.Cancelled:
                return {
                    kind: 'Cancelled',
                }
        }
    }
}

export function lake(options: LakeRunnerOptions): LakeRunner {
    return new LakeRunner(options)
}
