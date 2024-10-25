import * as fs from 'fs'
import { join } from 'path'
import { commands, Disposable, OutputChannel, QuickPickItem, window } from 'vscode'
import { LeanClient } from './leanclient'
import { batchExecute, displayResultError, ExecutionExitCode, ExecutionResult } from './utils/batch'
import { LeanClientProvider } from './utils/clientProvider'
import { toExtUri } from './utils/exturi'
import { cacheNotFoundError, lake, LakeRunner } from './utils/lake'
import { DirectGitDependency, Manifest, ManifestReadError, parseManifestInFolder } from './utils/manifest'
import { displayError, displayInformation, displayInformationWithInput, displayWarningWithInput } from './utils/notifs'

type DependencyToolchainResult =
    | { kind: 'Success'; dependencyToolchain: string }
    | { kind: 'DoNotUpdate' }
    | { kind: 'Cancelled' }

export class ProjectOperationProvider implements Disposable {
    private subscriptions: Disposable[] = []
    private isRunningOperation: boolean = false // Used to synchronize project operations

    constructor(
        private channel: OutputChannel,
        private clientProvider: LeanClientProvider,
    ) {
        this.subscriptions.push(
            commands.registerCommand('lean4.project.build', () => this.buildProject()),
            commands.registerCommand('lean4.project.clean', () => this.cleanProject()),
            commands.registerCommand('lean4.project.updateDependency', () => this.updateDependency()),
            commands.registerCommand('lean4.project.fetchCache', () => this.fetchMathlibCache()),
            commands.registerCommand('lean4.project.fetchFileCache', () => this.fetchMathlibCacheForFocusedFile()),
        )
    }

    private async buildProject() {
        await this.runOperation('Build Project', async lakeRunner => {
            const fetchResult: 'Success' | 'CacheNotAvailable' | 'Cancelled' = await this.tryFetchingCache(lakeRunner)
            if (fetchResult === 'Cancelled') {
                return
            }

            const result: ExecutionResult = await lakeRunner.build()
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                displayResultError(result, 'Cannot build project.')
                return
            }

            displayInformation('Project built successfully.')
            return
        })
    }

    private async cleanProject() {
        const deleteInput = 'Proceed'
        const deleteChoice: string | undefined = await displayInformationWithInput(
            'Delete all build artifacts?',
            deleteInput,
        )
        if (deleteChoice !== deleteInput) {
            return
        }

        await this.runOperation('Clean Project', async lakeRunner => {
            const cleanResult: ExecutionResult = await lakeRunner.clean()
            if (cleanResult.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (cleanResult.exitCode !== ExecutionExitCode.Success) {
                displayResultError(cleanResult, 'Cannot delete build artifacts.')
                return
            }

            const checkResult: 'Yes' | 'No' | 'Cancelled' = await lakeRunner.isMathlibCacheGetAvailable()
            if (checkResult === 'Cancelled') {
                return
            }
            if (checkResult === 'No') {
                displayInformation('Project cleaned successfully.')
                return
            }

            const fetchMessage = "Project cleaned successfully. Do you want to fetch Mathlib's build artifact cache?"
            const fetchInput = 'Fetch Cache'
            const fetchChoice: string | undefined = await displayInformationWithInput(fetchMessage, fetchInput)
            if (fetchChoice !== fetchInput) {
                return
            }

            const fetchResult: ExecutionResult = await lakeRunner.fetchMathlibCache()
            if (fetchResult.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (fetchResult.exitCode !== ExecutionExitCode.Success) {
                void displayResultError(fetchResult, 'Cannot fetch Mathlib build artifact cache.')
                return
            }
            displayInformation('Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCache() {
        await this.runOperation('Fetch Mathlib Build Cache', async lakeRunner => {
            const result: ExecutionResult = await lakeRunner.fetchMathlibCache()
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                if (result.stderr.includes(cacheNotFoundError)) {
                    displayError('This command cannot be used in non-Mathlib projects.')
                    return
                }
                displayResultError(result, 'Cannot fetch Mathlib build artifact cache.')
                return
            }

            displayInformation('Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCacheForFocusedFile() {
        await this.runOperation('Fetch Mathlib Build Cache For Focused File', async lakeRunner => {
            const projectUri = lakeRunner.cwdUri!

            if (!window.activeTextEditor || window.activeTextEditor.document.languageId !== 'lean4') {
                displayError(
                    'No active Lean editor tab. Make sure to focus the Lean editor tab for which you want to fetch the cache.',
                )
                return
            }

            const activeFileUri = toExtUri(window.activeTextEditor.document.uri)
            if (activeFileUri === undefined) {
                displayError(
                    `Cannot fetch cache of file with invalid URI kind: ${window.activeTextEditor.document.uri}`,
                )
                return
            }
            if (activeFileUri.scheme === 'untitled') {
                displayError('Cannot fetch cache of untitled files.')
                return
            }

            const manifestResult: Manifest | ManifestReadError = await parseManifestInFolder(projectUri)
            if (typeof manifestResult === 'string') {
                displayError(manifestResult)
                return
            }

            const projectName = manifestResult.name
            if (projectName === undefined) {
                displayError(
                    `Cannot determine project name from manifest. This is likely caused by the fact that the manifest version (${manifestResult.version}) is too outdated to contain the name of the project.`,
                )
                return
            }
            if (projectName !== 'mathlib') {
                displayError(
                    "Cache of focused file can only be fetched in Mathlib itself. Use the 'Project: Fetch Mathlib Build Cache' command for fetching the full Mathlib build cache in projects depending on Mathlib.",
                )
                return
            }

            const relativeActiveFileUri = activeFileUri.relativeTo(projectUri)
            if (relativeActiveFileUri === undefined) {
                displayError(
                    `Cannot fetch cache of focused file: focused file (${activeFileUri.fsPath}) is not contained in active project folder (${projectUri.fsPath}).`,
                )
                return
            }

            const result: ExecutionResult = await lakeRunner.fetchMathlibCacheForFile(relativeActiveFileUri)
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                displayResultError(
                    result,
                    `Cannot fetch Mathlib build artifact cache for '${relativeActiveFileUri.fsPath}'.`,
                )
                return
            }

            displayInformation(
                `Mathlib build artifact cache for '${relativeActiveFileUri.fsPath}' fetched successfully.`,
            )
        })
    }

    private async updateDependency() {
        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            displayError('No active client.')
            return
        }

        const activeFolderUri = activeClient.folderUri

        if (activeFolderUri.scheme === 'untitled') {
            displayError('Cannot update dependency of untitled file.')
            return
        }

        const manifestResult: Manifest | ManifestReadError = await parseManifestInFolder(activeFolderUri)
        if (typeof manifestResult === 'string') {
            displayError(manifestResult)
            return
        }

        const dependencies: (DirectGitDependency & { remoteRevision?: string | undefined })[] =
            await this.findUpdateableDependencies(manifestResult.directGitDependencies)
        if (dependencies.length === 0) {
            displayInformation('Nothing to update - all dependencies are up-to-date.')
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
                ...gitDep,
            }
        })

        const dependencyChoice: GitDependencyQuickPickItem | undefined = await window.showQuickPick(items, {
            title: 'Choose a dependency to update',
            canPickMany: false,
        })
        if (!dependencyChoice) {
            return
        }

        const warningMessage = `This command will update ${dependencyChoice.name} to its most recent version. It is only intended to be used by maintainers of this project. If the updated version of ${dependencyChoice.name} is incompatible with any other dependency or the code in this project, this project may not successfully build anymore. Are you sure you want to proceed?`
        const warningInput = 'Proceed'
        const warningChoice = await displayWarningWithInput(warningMessage, warningInput)
        if (warningChoice !== warningInput) {
            return
        }

        await this.runOperation('Update Dependency', async lakeRunner => {
            const result: ExecutionResult = await lakeRunner.updateDependency(dependencyChoice.name)
            if (result.exitCode === ExecutionExitCode.Cancelled) {
                return
            }
            if (result.exitCode !== ExecutionExitCode.Success) {
                void displayResultError(result, 'Cannot update dependency.')
                return
            }

            await this.tryFetchingCache(lakeRunner)

            const localToolchainPath: string = join(activeFolderUri.fsPath, 'lean-toolchain')
            const dependencyToolchainPath: string = join(
                activeFolderUri.fsPath,
                manifestResult.packagesDir,
                dependencyChoice.name,
                'lean-toolchain',
            )
            const dependencyToolchainResult = await this.determineDependencyToolchain(
                localToolchainPath,
                dependencyToolchainPath,
                dependencyChoice.name,
            )
            if (dependencyToolchainResult.kind === 'Cancelled') {
                return
            }

            if (dependencyToolchainResult.kind !== 'DoNotUpdate') {
                try {
                    fs.writeFileSync(localToolchainPath, dependencyToolchainResult.dependencyToolchain)
                } catch {
                    displayError('Cannot update Lean version.')
                    return
                }
            }
        })
    }

    private async findUpdateableDependencies(dependencies: DirectGitDependency[]) {
        const augmented: (DirectGitDependency & { remoteRevision?: string | undefined })[] = []

        for (const dependency of dependencies) {
            const result: ExecutionResult = await batchExecute('git', [
                'ls-remote',
                dependency.uri.toString(),
                dependency.inputRevision,
            ])
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

    private async determineDependencyToolchain(
        localToolchainPath: string,
        dependencyToolchainPath: string,
        dependencyName: string,
    ): Promise<DependencyToolchainResult> {
        const toolchainResult = await this.readToolchains(localToolchainPath, dependencyToolchainPath)
        if (!(toolchainResult instanceof Array)) {
            const errorFlavor =
                toolchainResult === 'CannotReadLocalToolchain'
                    ? `Could not read Lean version of open project at '${localToolchainPath}'`
                    : `Could not read Lean version of ${dependencyName} at ${dependencyToolchainPath}`
            const message = `${errorFlavor}. Do you want to update ${dependencyName} without updating the Lean version of the open project to that of ${dependencyName} regardless?`
            const input = 'Proceed'
            const choice: string | undefined = await displayInformationWithInput(message, input)
            return choice === 'input' ? { kind: 'DoNotUpdate' } : { kind: 'Cancelled' }
        }
        const [localToolchain, dependencyToolchain]: [string, string] = toolchainResult

        if (localToolchain === dependencyToolchain) {
            return { kind: 'DoNotUpdate' }
        }

        const message = `The Lean version '${localToolchain}' of the open project differs from the Lean version '${dependencyToolchain}' of ${dependencyName}. Do you want to update the Lean version of the open project to the Lean version of ${dependencyName}?`
        const input1 = 'Update Lean Version'
        const input2 = 'Keep Lean Version'
        const choice = await displayInformationWithInput(message, input1, input2)
        if (choice === undefined) {
            return { kind: 'Cancelled' }
        }
        if (choice !== input1) {
            return { kind: 'DoNotUpdate' }
        }

        return { kind: 'Success', dependencyToolchain }
    }

    private async readToolchains(
        localToolchainPath: string,
        dependencyToolchainPath: string,
    ): Promise<[string, string] | 'CannotReadLocalToolchain' | 'CannotReadDependencyToolchain'> {
        let localToolchain: string
        try {
            localToolchain = fs.readFileSync(localToolchainPath, 'utf8').trim()
        } catch (e) {
            return 'CannotReadLocalToolchain'
        }

        let dependencyToolchain: string
        try {
            dependencyToolchain = fs.readFileSync(dependencyToolchainPath, 'utf8').trim()
        } catch (e) {
            return 'CannotReadDependencyToolchain'
        }

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

    private async runOperation(context: string, command: (lakeRunner: LakeRunner) => Promise<void>) {
        if (this.isRunningOperation) {
            displayError('Another project action is already being executed. Please wait for its completion.')
            return
        }
        this.isRunningOperation = true

        if (!this.clientProvider) {
            displayError('Lean client has not loaded yet.')
            this.isRunningOperation = false
            return
        }

        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            displayError('No active client.')
            this.isRunningOperation = false
            return
        }

        if (activeClient.folderUri.scheme === 'untitled') {
            displayError('Cannot run project action for untitled files.')
            this.isRunningOperation = false
            return
        }

        const lakeRunner: LakeRunner = lake(this.channel, activeClient.folderUri, context)

        const result: 'Success' | 'IsRestarting' = await activeClient.withStoppedClient(() => command(lakeRunner))
        if (result === 'IsRestarting') {
            displayError('Cannot run project action while restarting the server.')
        }

        this.isRunningOperation = false
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}

interface GitDependencyQuickPickItem extends QuickPickItem, DirectGitDependency {}
