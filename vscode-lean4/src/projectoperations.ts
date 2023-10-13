import { Disposable, commands, window, OutputChannel, QuickPickItem, Uri } from 'vscode';
import { LakeRunner, cacheNotFoundError, lake, lakeInActiveFolder } from './utils/lake';
import { ExecutionExitCode, ExecutionResult, batchExecute, displayError } from './utils/batch';
import { LeanClientProvider } from './utils/clientProvider';
import { LeanClient } from './leanclient';
import { findLeanPackageRoot } from './utils/projectInfo';
import { join } from 'path';
import * as fs from 'fs'
import { DirectGitDependency, Manifest, ManifestReadError, parseAsManifest, parseManifestInFolder } from './utils/manifest';

export class ProjectOperationProvider implements Disposable {

    private subscriptions: Disposable[] = []
    private isRunningOperation: boolean = false // Used to synchronize project operations

    constructor(private channel: OutputChannel, private clientProvider: LeanClientProvider) {
        this.subscriptions.push(
            commands.registerCommand('lean4.project.build', () => this.buildProject()),
            commands.registerCommand('lean4.project.clean', () => this.cleanProject()),
            commands.registerCommand('lean4.project.updateDependency', () => this.updateDependency()),
            commands.registerCommand('lean4.project.fetchCache', () => this.fetchMathlibCache())
        )
    }

    private async buildProject() {
        await this.runOperation(async lakeRunner => {
            const fetchResult: 'Success' | 'CacheNotAvailable' | 'Cancelled' = await this.tryFetchingCache(lakeRunner)
            if (fetchResult === 'Cancelled') {
                return
            }

            const result: ExecutionResult = await lakeRunner.build()
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                void displayError(result, 'Cannot build project.')
                return
            }

            void window.showInformationMessage('Project built successfully.')
            return
        })
    }

    private async cleanProject() {
        const deleteInput = 'Proceed'
        const deleteChoice: string | undefined = await window.showInformationMessage('Delete all build artifacts?', { modal: true }, deleteInput)
        if (deleteChoice !== deleteInput) {
            return
        }

        await this.runOperation(async lakeRunner => {
            const cleanResult: ExecutionResult = await lakeRunner.clean()
            if (cleanResult.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (cleanResult.exitCode !== ExecutionExitCode.Success) {
                void displayError(cleanResult, 'Cannot delete build artifacts.')
                return
            }

            const checkResult: 'Yes' | 'No' | 'Cancelled' = await lakeRunner.isMathlibCacheGetAvailable()
            if (checkResult === 'Cancelled') {
                return
            }
            if (checkResult === 'No') {
                void window.showInformationMessage('Project cleaned successfully.')
                return
            }

            const fetchMessage = 'Project cleaned successfully. Do you want to fetch Mathlib\'s build artifact cache?'
            const fetchInput = 'Fetch Cache'
            const fetchChoice: string | undefined = await window.showInformationMessage(fetchMessage, { modal: true }, fetchInput)
            if (fetchChoice !== fetchInput) {
                return
            }

            const fetchResult: ExecutionResult = await lakeRunner.fetchMathlibCache()
            if (fetchResult.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (fetchResult.exitCode !== ExecutionExitCode.Success) {
                void displayError(fetchResult, 'Cannot fetch Mathlib build artifact cache.')
                return
            }
            void window.showInformationMessage('Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCache() {
        await this.runOperation(async lakeRunner => {
            const result: ExecutionResult = await lakeRunner.fetchMathlibCache()
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                if (result.stderr.includes(cacheNotFoundError)) {
                    void window.showErrorMessage('This command cannot be used in non-Mathlib projects.')
                    return
                }
                void displayError(result, 'Cannot fetch Mathlib build artifact cache.')
                return
            }

            void window.showInformationMessage('Mathlib build artifact cache fetched successfully.')
        })
    }

    private async updateDependency() {
        if (!window.activeTextEditor) {
            return
        }

        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            void window.showErrorMessage('No active client.')
            this.isRunningOperation = false
            return
        }

        const manifestResult: Manifest | ManifestReadError = await parseManifestInFolder(activeClient.folderUri)
        if (typeof manifestResult === 'string') {
            void window.showErrorMessage(manifestResult)
            return
        }

        const dependencies: (DirectGitDependency & { remoteRevision?: string | undefined })[] =
            await this.findUpdateableDependencies(manifestResult.directGitDependencies)
        if (dependencies.length === 0) {
            void window.showInformationMessage('Nothing to update - all dependencies are up-to-date.')
            return
        }

        const items: GitDependencyQuickPickItem[] = dependencies.map(gitDep => {
            const shortLocalRevision: string = gitDep.revision.substring(0, 7)
            const shortRemoteRevision: string | undefined = gitDep.remoteRevision?.substring(0, 7)

            const detail: string = shortRemoteRevision
                ? `Current: ${shortLocalRevision} ⟹ New: ${shortRemoteRevision}`
                : `Current: ${shortLocalRevision}`

            return {
                label: `${gitDep.name} @ ${gitDep.inputRevision}`,
                description: gitDep.uri.toString(),
                detail,
                ...gitDep
            }
        })

        const dependencyChoice: GitDependencyQuickPickItem | undefined = await window.showQuickPick(items, {
            title: 'Choose a dependency to update',
            canPickMany: false
        })
        if (!dependencyChoice) {
            return
        }

        const localToolchainPath: string = join(activeClient.folderUri.fsPath, 'lean-toolchain')
        const dependencyToolchainResult: string | 'DoNotUpdate' | 'Cancelled' = await this.determineDependencyToolchain(localToolchainPath, dependencyChoice)
        if (dependencyToolchainResult === 'Cancelled') {
            return
        }

        await this.runOperation(async lakeRunner => {
            if (dependencyToolchainResult !== 'DoNotUpdate') {
                try {
                    fs.writeFileSync(localToolchainPath, dependencyToolchainResult)
                } catch {
                    void window.showErrorMessage('Cannot update Lean version.')
                    return
                }
            }

            const result: ExecutionResult = await lakeRunner.updateDependency(dependencyChoice.name)
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                void displayError(result, 'Cannot update dependency.')
                return
            }

            await this.tryFetchingCache(lakeRunner)
        })
    }

    private async findUpdateableDependencies(dependencies: DirectGitDependency[]) {
        const augmented: (DirectGitDependency & { remoteRevision?: string | undefined })[] = []

        for (const dependency of dependencies) {
            const result: ExecutionResult = await batchExecute('git', ['ls-remote', dependency.uri.toString(), dependency.inputRevision])
            if (result.exitCode !== ExecutionExitCode.Success) {
                augmented.push(dependency)
                continue
            }

            const matches: RegExpMatchArray | null = result.stdout.match(/^[a-z0-9]+/)
            if (!matches) {
                augmented.push(dependency)
                continue
            }

            const remoteRevision: string = matches[0]
            if (dependency.revision === remoteRevision) {
                // Cannot be updated - filter it
                continue
            }

            augmented.push({ remoteRevision, ...dependency })
        }

        return augmented
    }

    private async determineDependencyToolchain(localToolchainPath: string, dependency: DirectGitDependency): Promise<string | 'DoNotUpdate' | 'Cancelled'> {
        const dependencyToolchainUri: Uri | undefined = this.determineDependencyToolchainUri(dependency.uri, dependency.inputRevision)
        if (!dependencyToolchainUri) {
            const message = `Could not determine Lean version of ${dependency.name} at ${dependency.uri}, as doing so is currently only supported for GitHub projects. Do you want to update ${dependency.name} without updating the local Lean version to that of ${dependency.name} regardless?`
            const input = 'Proceed'
            const choice: string | undefined = await window.showInformationMessage(message, { modal: true}, input)
            return choice === 'input' ? 'DoNotUpdate' : 'Cancelled'
        }

        const toolchainResult = await this.fetchToolchains(localToolchainPath, dependencyToolchainUri)
        if (!(toolchainResult instanceof Array)) {
            const errorFlavor = toolchainResult === 'CannotReadLocalToolchain'
                ? `Could not read local Lean version at '${localToolchainPath}'`
                : `Could not fetch Lean version of ${dependency.name} at ${dependency.uri}`
            const message = `${errorFlavor}. Do you want to update ${dependency.name} without updating the local Lean version to that of ${dependency.name} regardless?`
            const input = 'Proceed'
            const choice: string | undefined = await window.showInformationMessage(message, { modal: true}, input)
            return choice === 'input' ? 'DoNotUpdate' : 'Cancelled'
        }
        const [localToolchain, dependencyToolchain]: [string, string] = toolchainResult

        if (localToolchain === dependencyToolchain) {
            return 'DoNotUpdate'
        }

        const message = `'${localToolchain}' (local Lean version) differs from '${dependencyToolchain}' (${dependency.name} Lean version). Do you want to update the local Lean version to the Lean version of ${dependency.name}?`
        const input1 = 'Update Local Version'
        const input2 = 'Keep Local Version'
        const choice = await window.showInformationMessage(message, { modal: true }, input1, input2)
        if (choice === undefined) {
            return 'Cancelled'
        }
        if (choice !== input1) {
            return 'DoNotUpdate'
        }

        return dependencyToolchain
    }

    private determineDependencyToolchainUri(dependencyUri: Uri, inputRevision: string): Uri | undefined {
        // Example:
        // Input: https://github.com/leanprover-community/mathlib4
        // Output: https://raw.githubusercontent.com/leanprover-community/mathlib4/master/lean-toolchain

        if (!dependencyUri.authority.includes('github.com')) {
            return undefined
        }
        const match = dependencyUri.path.match(/\/([^\\]+\/[^\\\.]+)(\.git)?\/?/)
        if (!match) {
            return undefined
        }
        const repoPath: string = match[1]

        return Uri.from({
            scheme: 'https',
            authority: 'raw.githubusercontent.com',
            path: join(repoPath, inputRevision, 'lean-toolchain')
        })
    }

    private async fetchToolchains(localToolchainPath: string, dependencyToolchainUri: Uri): Promise<[string, string] | 'CannotReadLocalToolchain' | 'CannotReadDependencyToolchain'> {
        let localToolchain: string
        try {
            localToolchain = fs.readFileSync(localToolchainPath, 'utf8').trim()
        } catch (e) {
            return 'CannotReadLocalToolchain'
        }

        const curlResult: ExecutionResult = await batchExecute('curl', ['-f', '-L', dependencyToolchainUri.toString()])
        if (curlResult.exitCode !== ExecutionExitCode.Success) {
            return 'CannotReadDependencyToolchain'
        }
        const dependencyToolchain: string = curlResult.stdout.trim()

        return [localToolchain, dependencyToolchain]
    }

    private async tryFetchingCache(lakeRunner: LakeRunner): Promise<'Success' | 'CacheNotAvailable' | 'Cancelled'> {
        const fetchResult: ExecutionResult = await lakeRunner.fetchMathlibCache(true)
        switch (fetchResult.exitCode) {
            case ExecutionExitCode.Success:
                return 'Success'
            case ExecutionExitCode.Cancelled:
                return 'Cancelled'
            default:
                return 'CacheNotAvailable'
        }
    }

    private async runOperation(command: (lakeRunner: LakeRunner) => Promise<void>) {
        if (this.isRunningOperation) {
            void window.showErrorMessage('Another project action is already being executed. Please wait for its completion.')
            return
        }
        this.isRunningOperation = true

        if (!this.clientProvider) {
            void window.showErrorMessage('Lean client has not loaded yet.')
            this.isRunningOperation = false
            return
        }

        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            void window.showErrorMessage('No active client.')
            this.isRunningOperation = false
            return
        }

        const lakeRunner: LakeRunner = lake(this.channel, activeClient.folderUri)

        const result: 'Success' | 'IsRestarting' = await activeClient.withStoppedClient(() => command(lakeRunner))
        if (result === 'IsRestarting') {
            void window.showErrorMessage('Cannot run project action while restarting the server.')
        }

        this.isRunningOperation = false
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

}

interface GitDependencyQuickPickItem extends QuickPickItem, DirectGitDependency {
}
