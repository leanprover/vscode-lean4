import { Uri, window } from 'vscode';
import { ExecutionExitCode, ExecutionResult, batchExecute, batchExecuteWithProgress } from './batch';
import { findLeanPackageRoot } from './projectInfo';

export const cacheNotFoundError = 'unknown executable `cache`'

export class LakeRunner {
    cwdUri: Uri | undefined
    toolchain: string | undefined

    constructor(cwdUri: Uri | undefined, toolchain?: string | undefined) {
        this.cwdUri = cwdUri
        this.toolchain = toolchain
    }

    async initProject(name: string, kind: string): Promise<ExecutionResult> {
        return this.runLakeCommandSilently('init', [name, kind])
    }

    async updateDependencies(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('update', [], 'Updating dependencies ...')
    }

    async build(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('build', [], 'Building Lean project ...')
    }

    async clean(): Promise<ExecutionResult> {
        return this.runLakeCommandWithProgress('clean', [], 'Cleaning Lean project ...')
    }

    async fetchMathlibCache(filterError: boolean = false): Promise<ExecutionResult> {
        const prompt = 'Checking whether Mathlib build artifact cache needs to be downloaded ...'
        return this.runLakeCommandWithProgress('exe', ['cache', 'get'], prompt, line => {
            if (filterError && line.includes(cacheNotFoundError)) {
                return undefined
            }
            return line
        })
    }

    async isMathlibCacheGetAvailable(): Promise<boolean> {
        const result: ExecutionResult = await this.runLakeCommandSilently('exe', ['cache'])
        return result.exitCode === ExecutionExitCode.Success
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
            translator?: ((line: string) => string | undefined) | undefined): Promise<ExecutionResult> {
        args = args.slice()
        args.unshift(subCommand)
        if (this.toolchain) {
            args.unshift(`+${this.toolchain}`)
        }
        return await batchExecuteWithProgress('lake', args, waitingPrompt, this.cwdUri?.fsPath, undefined, translator)
    }
}

export function lake(cwdUri: Uri | undefined, toolchain?: string | undefined): LakeRunner {
    return new LakeRunner(cwdUri, toolchain)
}

export async function lakeInActiveFolder(toolchain?: string | undefined): Promise<LakeRunner | 'NoActiveFolder'> {
    if (!window.activeTextEditor) {
        return 'NoActiveFolder'
    }

    const [_1, folderUri, _2] = await findLeanPackageRoot(window.activeTextEditor.document.uri)
    if (!folderUri) {
        return 'NoActiveFolder'
    }

    return lake(folderUri, toolchain)
}
