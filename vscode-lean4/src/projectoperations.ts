import { Disposable, commands, window, OutputChannel } from 'vscode';
import { LakeRunner, cacheNotFoundError, lakeInActiveFolder } from './utils/lake';
import { ExecutionExitCode, ExecutionResult, displayError } from './utils/batch';
import { LeanClientProvider } from './utils/clientProvider';
import { LeanClient } from './leanclient';

export class ProjectOperationProvider implements Disposable {

    private subscriptions: Disposable[] = []
    private isRunningOperation: boolean = false // Used to synchronize project operations

    constructor(private channel: OutputChannel, private clientProvider: LeanClientProvider) {
        this.subscriptions.push(
            commands.registerCommand('lean4.project.build', () => this.buildProject()),
            commands.registerCommand('lean4.project.clean', () => this.cleanProject()),
            commands.registerCommand('lean4.project.fetchCache', () => this.fetchMathlibCache())
        )
    }

    private async buildProject() {
        await this.runOperation(async lakeRunner => {
            // Try it. If this is not a mathlib project, it will fail silently. Otherwise, it will grab the cache.
            const fetchResult: ExecutionResult = await lakeRunner.fetchMathlibCache(true)
            if (fetchResult.exitCode === ExecutionExitCode.Cancelled) {
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

        const lakeRunner: LakeRunner | 'NoActiveFolder' = await lakeInActiveFolder(this.channel)
        if (lakeRunner === 'NoActiveFolder') {
            this.isRunningOperation = false
            return
        }

        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            void window.showErrorMessage('No active client.')
            this.isRunningOperation = false
            return
        }

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
