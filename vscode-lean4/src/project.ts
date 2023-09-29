import { Disposable, Uri, commands, window, workspace, SaveDialogOptions } from 'vscode';
import path = require('path');
import { checkParentFoldersForLeanProject, isValidLeanProject } from './utils/projectInfo';
import { elanSelfUpdate } from './utils/elan';
import { LakeRunner, cacheNotFoundError, lake, lakeInActiveFolder } from './utils/lake';
import { ExecutionExitCode, ExecutionResult, batchExecute, batchExecuteWithProgress, displayError } from './utils/batch';
import { LeanClientProvider } from './utils/clientProvider';
import { LeanClient } from './leanclient';

export class ProjectOperationProvider implements Disposable {

    private subscriptions: Disposable[] = [];
    clientProvider: LeanClientProvider | undefined = undefined // set when the lean 4 client loads

    constructor() {
        this.subscriptions.push(
            commands.registerCommand('lean4.project.createLibraryProject', () => this.createLibraryProject()),
            commands.registerCommand('lean4.project.createProgramProject', () => this.createProgramProject()),
            commands.registerCommand('lean4.project.createMathlibProject', () => this.createMathlibProject()),
            commands.registerCommand('lean4.project.open', () => this.openProject()),
            commands.registerCommand('lean4.project.clone', () => this.cloneProject()),
            commands.registerCommand('lean4.project.build', () => this.buildProject()),
            commands.registerCommand('lean4.project.clean', () => this.cleanProject()),
            commands.registerCommand('lean4.project.fetchCache', () => this.fetchMathlibCache())
        )
    }

    private async createLibraryProject() {
        const projectFolder: Uri | 'DidNotComplete' = await this.createProject('lib', 'library', 'stable')

        if (projectFolder !== 'DidNotComplete') {
            await ProjectOperationProvider.openNewFolder(projectFolder)
        }
    }

    private async createProgramProject() {
        const projectFolder: Uri | 'DidNotComplete' = await this.createProject('exe', 'program', 'stable')

        if (projectFolder !== 'DidNotComplete') {
            await ProjectOperationProvider.openNewFolder(projectFolder)
        }
    }

    private async createMathlibProject() {
        const mathlibToolchain = 'leanprover-community/mathlib4:lean-toolchain'
        const projectFolder: Uri | 'DidNotComplete' = await this.createProject('math', 'math formalization', mathlibToolchain)

        if (projectFolder === 'DidNotComplete') {
            return
        }

        const updateResult: ExecutionResult = await lake(projectFolder, mathlibToolchain).updateDependencies()
        if (updateResult.exitCode !== ExecutionExitCode.Success) {
            await displayError(updateResult, 'Cannot update dependencies.')
            return
        }

        const cacheGetResult: ExecutionResult = await lake(projectFolder, mathlibToolchain).fetchMathlibCache()
        if (cacheGetResult.exitCode !== ExecutionExitCode.Success) {
            await displayError(cacheGetResult, 'Cannot fetch Mathlib build artifact cache.')
            return
        }

        await ProjectOperationProvider.openNewFolder(projectFolder)
    }

    private async createProject(
        kind: string,
        kindName: string,
        toolchain?: string | undefined): Promise<Uri | 'DidNotComplete'>  {

        const projectFolder: Uri | undefined = await ProjectOperationProvider.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: `Create a new ${kindName} project folder`
        })
        if (projectFolder === undefined) {
            return 'DidNotComplete'
        }

        await workspace.fs.createDirectory(projectFolder)

        await elanSelfUpdate()

        const projectName: string = path.basename(projectFolder.fsPath)
        const result: ExecutionResult = await lake(projectFolder, toolchain).initProject(projectName, kind)
        if (result.exitCode !== ExecutionExitCode.Success) {
            await displayError(result, 'Cannot initialize project.')
            return 'DidNotComplete'
        }

        return projectFolder
    }

    private async openProject() {
        const projectFolders: Uri[] | undefined = await window.showOpenDialog({
            title: 'Open Lean 4 project folder containing a `lean-toolchain` file',
            openLabel: 'Open project folder',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        })
        if (projectFolders === undefined || projectFolders.length !== 1) {
            return
        }

        let projectFolder = projectFolders[0]
        if (!await ProjectOperationProvider.checkIsFileUriOrShowError(projectFolder)) {
            return
        }

        if (!await isValidLeanProject(projectFolder)) {
            const parentProjectFolder: Uri | undefined = await ProjectOperationProvider.attemptFindingLeanProjectInParentFolder(projectFolder)
            if (parentProjectFolder === undefined) {
                return
            }
            projectFolder = parentProjectFolder
        }

        // This kills the extension host, so it has to be the last command
        await commands.executeCommand('vscode.openFolder', projectFolder)
    }

    private static async attemptFindingLeanProjectInParentFolder(projectFolder: Uri): Promise<Uri | undefined> {
        const parentProjectFolder: Uri | undefined = await checkParentFoldersForLeanProject(projectFolder)
        if (parentProjectFolder === undefined) {
            void window.showErrorMessage('The selected folder is not a valid Lean 4 project folder. Please make sure to select a folder containing a \'lean-toolchain\' file.')
            return undefined
        }

        const message = `The selected folder is not a valid Lean 4 project folder because it does not contain a 'lean-toolchain' file.
However, a valid Lean 4 project folder was found in one of the parent directories at ${parentProjectFolder.fsPath}.
Open this project instead?`
        const input = 'Open parent directory project'
        const choice: string | undefined = await window.showInformationMessage(message, { modal: true }, input)
        if (choice !== input) {
            return undefined
        }

        return parentProjectFolder
    }

    private async cloneProject() {
        const unparsedProjectUri: string | undefined = await window.showInputBox({
            title: 'URL Input',
            value: 'https://github.com/leanprover-community/mathlib4',
            prompt: 'URL of Git repository for existing Lean 4 project',
            validateInput: value => {
                try {
                    Uri.parse(value, true)
                    return undefined // Valid URI
                } catch (e) {
                    return 'Invalid URL'
                }
            }
        })
        if (unparsedProjectUri === undefined) {
            return
        }
        const existingProjectUri = Uri.parse(unparsedProjectUri)

        const projectFolder: Uri | undefined = await ProjectOperationProvider.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: 'Create a new project folder to clone existing Lean 4 project into'
        })
        if (projectFolder === undefined) {
            return
        }

        const result: ExecutionResult = await batchExecuteWithProgress('git', ['clone', existingProjectUri.toString(), projectFolder.fsPath], 'Cloning project ...')
        if (result.exitCode !== ExecutionExitCode.Success) {
            await displayError(result, 'Cannot download project.')
            return
        }

        // Try it. If this is not a mathlib project, it will fail silently. Otherwise, it will grab the cache.
        await lake(projectFolder).fetchMathlibCache(true)

        await ProjectOperationProvider.openNewFolder(projectFolder)
    }

    private static async askForNewProjectFolderLocation(options: SaveDialogOptions): Promise<Uri | undefined> {
        const projectFolder: Uri | undefined = await window.showSaveDialog(options)
        if (projectFolder === undefined || !await this.checkIsFileUriOrShowError(projectFolder)) {
            return undefined
        }
        return projectFolder
    }

    private static async checkIsFileUriOrShowError(projectFolder: Uri): Promise<boolean> {
        if (projectFolder.scheme === 'file') {
            return true
        } else {
            void window.showErrorMessage('Project folder must be created in a file system.')
            return false
        }
    }

    private static async openNewFolder(projectFolder: Uri) {
        const message = `Project initialized. Open new project folder '${path.basename(projectFolder.fsPath)}'?`
        const input = 'Open project folder'
        const choice: string | undefined = await window.showInformationMessage(message, { modal: true }, input)
        if (choice === input) {
            // This kills the extension host, so it has to be the last command
            await commands.executeCommand('vscode.openFolder', projectFolder)
        }
    }

    private async buildProject() {
        await this.inActiveFolderWithoutServer(async lakeRunner => {
            // Try it. If this is not a mathlib project, it will fail silently. Otherwise, it will grab the cache.
            await lakeRunner.fetchMathlibCache(true)

            const result: ExecutionResult = await lakeRunner.build()
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

        await this.inActiveFolderWithoutServer(async lakeRunner => {
            const cleanResult: ExecutionResult = await lakeRunner.clean()
            if (cleanResult.exitCode !== ExecutionExitCode.Success) {
                void displayError(cleanResult, 'Cannot delete build artifacts.')
                return
            }

            if (!await lakeRunner.isMathlibCacheGetAvailable()) {
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
            if (fetchResult.exitCode !== ExecutionExitCode.Success) {
                void displayError(fetchResult, 'Cannot fetch Mathlib build artifact cache.')
                return
            }
            void window.showInformationMessage('Mathlib build artifact cache fetched successfully.')
        })
    }

    private async fetchMathlibCache() {
        await this.inActiveFolderWithoutServer(async lakeRunner => {
            const result: ExecutionResult = await lakeRunner.fetchMathlibCache()
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

    private async inActiveFolderWithoutServer(command: (lakeRunner: LakeRunner) => Promise<void>) {
        if (!this.clientProvider) {
            void window.showErrorMessage('Lean client has not been loaded yet.')
            return
        }

        const lakeRunner: LakeRunner | 'NoActiveFolder' = await lakeInActiveFolder()
        if (lakeRunner === 'NoActiveFolder') {
            return
        }

        const activeClient: LeanClient | undefined = this.clientProvider.getActiveClient()
        if (!activeClient) {
            void window.showErrorMessage('No active client.')
            return
        }

        if (activeClient.isRunning()) {
            await activeClient.stop()
        }

        await command(lakeRunner)

        if (!activeClient.isRunning()) {
            await activeClient.start()
        }
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

}
