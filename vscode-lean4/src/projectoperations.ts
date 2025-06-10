import * as fs from 'fs'
import { join } from 'path'
import { commands, Disposable, OutputChannel, QuickPickItem, window } from 'vscode'
import { LeanClient } from './leanclient'
import { batchExecute, ExecutionExitCode, ExecutionResult } from './utils/batch'
import { LeanClientProvider } from './utils/clientProvider'
import {
    CacheGetAvailabilityResult,
    displayLakeRunnerError,
    FetchMathlibCacheResult,
    lake,
    LakeRunner,
    LakeRunnerResult,
} from './utils/lake'
import { lean } from './utils/leanEditorProvider'
import { DirectGitDependency, Manifest, ManifestReadError, parseManifestInFolder } from './utils/manifest'
import { displayNotification, displayNotificationWithInput, displayNotificationWithOptionalInput } from './utils/notifs'

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
            commands.registerCommand('lean4.project.fetchFileCache', () => this.fetchMathlibCacheForCurrentImports()),
        )
    }

    private async buildProject() {
        await this.runOperation('Build Project', async lakeRunner => {
            const fetchResult: 'Success' | 'Failure' = await lakeRunner.tryFetchMathlibCacheWithError()
            if (fetchResult !== 'Success') {
                return
            }

            const result: LakeRunnerResult = await lakeRunner.build()
            if (result.kind === 'Cancelled') {
                return
            }
            if (result.kind !== 'Success') {
                displayLakeRunnerError(result, 'Cannot build project.')
                return
            }

            displayNotification('Information', 'Project built successfully.')
            return
        })
    }

    private async cleanProject() {
        const deleteInput = 'Proceed'
        const deleteChoice: string | undefined = await displayNotificationWithInput(
            'Information',
            'Delete all build artifacts?',
            [deleteInput],
        )
        if (deleteChoice !== deleteInput) {
            return
        }

        await this.runOperation('Clean Project', async lakeRunner => {
            const cleanResult: LakeRunnerResult = await lakeRunner.clean()
            if (cleanResult.kind === 'Cancelled') {
                return
            }
            if (cleanResult.kind !== 'Success') {
                displayLakeRunnerError(cleanResult, 'Cannot delete build artifacts.')
                return
            }

            const checkResult: CacheGetAvailabilityResult = await lakeRunner.isMathlibCacheGetAvailable()
            if (checkResult.kind === 'Cancelled') {
                return
            }
            if (checkResult.kind === 'CacheUnavailable') {
                displayNotification('Information', 'Project cleaned successfully.')
                return
            }
            if (checkResult.kind !== 'CacheAvailable') {
                displayLakeRunnerError(checkResult, 'Cannot check availability of Mathlib cache.')
                return
            }

            const fetchMessage = "Project cleaned successfully. Do you wish to fetch Mathlib's build artifact cache?"
            const fetchInput = 'Fetch Cache'
            const fetchChoice: string | undefined = await displayNotificationWithInput(
                'Information',
                fetchMessage,
                [fetchInput],
                'Do Not Fetch Cache',
            )
            if (fetchChoice !== fetchInput) {
                return
            }

            const fetchResult: 'Success' | 'Failure' = await lakeRunner.tryFetchMathlibCacheWithError()
            if (fetchResult !== 'Success') {
                return
            }
            displayNotification('Information', 'Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCache() {
        await this.runOperation('Fetch Mathlib Build Cache', async lakeRunner => {
            const fetchResult: FetchMathlibCacheResult = await lakeRunner.fetchMathlibCache()
            if (fetchResult.kind === 'Cancelled') {
                return
            }
            if (fetchResult.kind === 'CacheUnavailable') {
                displayNotification('Error', 'This command cannot be used in non-Mathlib projects.')
                return
            }
            if (fetchResult.kind !== 'Success') {
                displayLakeRunnerError(fetchResult, 'Cannot fetch Mathlib build artifact cache.')
                return
            }

            displayNotification('Information', 'Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCacheForCurrentImports() {
        await this.runOperation('Fetch Mathlib Build Cache For Current Imports', async lakeRunner => {
            const projectUri = lakeRunner.options.cwdUri!

            const doc = lean.lastActiveLeanDocument
            if (doc === undefined) {
                displayNotification(
                    'Error',
                    'No active Lean editor tab. Make sure to focus the Lean editor tab for which you want to fetch the cache.',
                )
                return
            }
            const docUri = doc.extUri

            if (docUri.scheme === 'untitled') {
                displayNotification('Error', 'Cannot fetch cache of untitled files.')
                return
            }

            const manifestResult: Manifest | ManifestReadError = await parseManifestInFolder(projectUri)
            if (typeof manifestResult === 'string') {
                displayNotification('Error', manifestResult)
                return
            }

            const projectName = manifestResult.name
            if (projectName === undefined) {
                displayNotification(
                    'Error',
                    `Cannot determine project name from manifest. This is likely caused by the fact that the manifest version (${manifestResult.version}) is too outdated to contain the name of the project.`,
                )
                return
            }
            if (projectName !== 'mathlib') {
                displayNotification(
                    'Error',
                    "Cache for current imports can only be fetched in Mathlib itself. Use the 'Project: Fetch Mathlib Build Cache' command for fetching the full Mathlib build cache in projects depending on Mathlib.",
                )
                return
            }

            const relativeDocUri = docUri.relativeTo(projectUri)
            if (relativeDocUri === undefined) {
                displayNotification(
                    'Error',
                    `Cannot fetch cache for current imports: active file (${docUri.fsPath}) is not contained in active project folder (${projectUri.fsPath}).`,
                )
                return
            }

            const fetchResult: FetchMathlibCacheResult = await lakeRunner.fetchMathlibCacheForFile(relativeDocUri)
            if (fetchResult.kind === 'Cancelled') {
                return
            }
            if (fetchResult.kind === 'CacheUnavailable') {
                displayNotification('Error', 'This command cannot be used in non-Mathlib projects.')
                return
            }
            if (fetchResult.kind !== 'Success') {
                displayLakeRunnerError(
                    fetchResult,
                    `Cannot fetch Mathlib build artifact cache for '${relativeDocUri.fsPath}'.`,
                )
                return
            }

            displayNotificationWithOptionalInput(
                'Information',
                `Mathlib build artifact cache for '${relativeDocUri.fsPath}' fetched successfully.`,
                [{ input: 'Restart File', action: () => this.clientProvider.restartFile(relativeDocUri) }],
            )
        })
    }

    private async updateDependency() {
        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            displayNotification('Error', 'No active client.')
            return
        }

        const activeFolderUri = activeClient.folderUri

        if (activeFolderUri.scheme === 'untitled') {
            displayNotification('Error', 'Cannot update dependency of untitled file.')
            return
        }

        const manifestResult: Manifest | ManifestReadError = await parseManifestInFolder(activeFolderUri)
        if (typeof manifestResult === 'string') {
            displayNotification('Error', manifestResult)
            return
        }

        const dependencies: (DirectGitDependency & { remoteRevision?: string | undefined })[] =
            await this.findUpdateableDependencies(manifestResult.directGitDependencies)
        if (dependencies.length === 0) {
            displayNotification('Information', 'Nothing to update - all dependencies are up-to-date.')
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
        const warningChoice = await displayNotificationWithInput('Warning', warningMessage, [warningInput])
        if (warningChoice !== warningInput) {
            return
        }

        await this.runOperation('Update Dependency', async lakeRunner => {
            const result: LakeRunnerResult = await lakeRunner.updateDependency(dependencyChoice.name)
            if (result.kind === 'Cancelled') {
                return
            }
            if (result.kind !== 'Success') {
                displayLakeRunnerError(result, 'Cannot update dependency.')
                return
            }

            const fetchResult: 'Success' | 'Failure' = await lakeRunner.tryFetchMathlibCacheWithError()
            if (fetchResult !== 'Success') {
                return
            }

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
                    displayNotification('Error', 'Cannot update Lean version.')
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
            const message = `${errorFlavor}. Do you wish to update ${dependencyName} without updating the Lean version of the open project to that of ${dependencyName} regardless?`
            const input = 'Proceed'
            const choice: string | undefined = await displayNotificationWithInput('Information', message, [input])
            return choice === 'input' ? { kind: 'DoNotUpdate' } : { kind: 'Cancelled' }
        }
        const [localToolchain, dependencyToolchain]: [string, string] = toolchainResult

        if (localToolchain === dependencyToolchain) {
            return { kind: 'DoNotUpdate' }
        }

        const message = `The Lean version '${localToolchain}' of the open project differs from the Lean version '${dependencyToolchain}' of ${dependencyName}. Do you wish to update the Lean version of the open project to the Lean version of ${dependencyName}?`
        const updateInput = 'Update Lean Version'
        const keepInput = 'Keep Lean Version'
        const choice = await displayNotificationWithInput('Information', message, [keepInput, updateInput])
        if (choice === undefined) {
            return { kind: 'Cancelled' }
        }
        if (choice !== updateInput) {
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

    private async runOperation(context: string, command: (lakeRunner: LakeRunner) => Promise<void>) {
        if (this.isRunningOperation) {
            displayNotification(
                'Error',
                'Another project action is already being executed. Please wait for its completion.',
            )
            return
        }
        this.isRunningOperation = true
        try {
            if (!this.clientProvider) {
                displayNotification('Error', 'Lean client has not loaded yet.')
                return
            }

            const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
            if (!activeClient) {
                displayNotification('Error', 'No active client.')
                return
            }

            if (activeClient.folderUri.scheme === 'untitled') {
                displayNotification('Error', 'Cannot run project action for untitled files.')
                return
            }

            const lakeRunner: LakeRunner = lake({
                channel: this.channel,
                cwdUri: activeClient.folderUri,
                context,
                toolchainUpdateMode: 'DoNotUpdate',
            })

            const result: 'Success' | 'IsRestarting' = await activeClient.withStoppedClient(() => command(lakeRunner))
            if (result === 'IsRestarting') {
                displayNotification('Error', 'Cannot run project action while restarting the server.')
            }
        } finally {
            this.isRunningOperation = false
        }
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}

interface GitDependencyQuickPickItem extends QuickPickItem, DirectGitDependency {}
