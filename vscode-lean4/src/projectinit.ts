import { commands, Disposable, OutputChannel, SaveDialogOptions, Uri, window, workspace } from 'vscode'
import { checkLean4ProjectInitPreconditions } from './projectInitDiagnostics'
import {
    batchExecute,
    batchExecuteWithProgress,
    displayResultError,
    ExecutionExitCode,
    ExecutionResult,
} from './utils/batch'
import { FileUri } from './utils/exturi'
import { lake } from './utils/lake'
import { LeanInstaller } from './utils/leanInstaller'
import { displayError, displayInformationWithInput } from './utils/notifs'
import { checkParentFoldersForLeanProject, isValidLeanProject } from './utils/projectInfo'
import { PreconditionCheckResult } from './utils/setupDiagnostics'
import path = require('path')

export class ProjectInitializationProvider implements Disposable {
    private subscriptions: Disposable[] = []

    constructor(
        private channel: OutputChannel,
        private installer: LeanInstaller,
    ) {
        this.subscriptions.push(
            commands.registerCommand('lean4.project.createStandaloneProject', () => this.createStandaloneProject()),
            commands.registerCommand('lean4.project.createMathlibProject', () => this.createMathlibProject()),
            commands.registerCommand('lean4.project.open', () => this.openProject()),
            commands.registerCommand('lean4.project.clone', () => this.cloneProject()),
        )
    }

    private async createStandaloneProject() {
        const toolchain = 'leanprover/lean4:stable'
        const projectFolder: FileUri | 'DidNotComplete' = await this.createProject(undefined, toolchain)
        if (projectFolder === 'DidNotComplete') {
            return
        }

        const buildResult: ExecutionResult = await lake(this.channel, projectFolder, toolchain).build()
        if (buildResult.exitCode === ExecutionExitCode.Cancelled) {
            return
        }
        if (buildResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(buildResult, 'Cannot build Lean project.')
            return
        }

        const initialCommitResult: 'Success' | 'GitAddFailed' | 'GitCommitFailed' =
            await this.createInitialCommit(projectFolder)
        if (initialCommitResult !== 'Success') {
            return
        }

        await ProjectInitializationProvider.openNewFolder(projectFolder)
    }

    private async createMathlibProject() {
        const mathlibToolchain = 'leanprover-community/mathlib4:lean-toolchain'
        const projectFolder: FileUri | 'DidNotComplete' = await this.createProject('math', mathlibToolchain)
        if (projectFolder === 'DidNotComplete') {
            return
        }

        const cacheGetResult: ExecutionResult = await lake(
            this.channel,
            projectFolder,
            mathlibToolchain,
        ).fetchMathlibCache()
        if (cacheGetResult.exitCode === ExecutionExitCode.Cancelled) {
            return
        }
        if (cacheGetResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(cacheGetResult, 'Cannot fetch Mathlib build artifact cache.')
            return
        }

        const buildResult: ExecutionResult = await lake(this.channel, projectFolder, mathlibToolchain).build()
        if (buildResult.exitCode === ExecutionExitCode.Cancelled) {
            return
        }
        if (buildResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(buildResult, 'Cannot build Lean project.')
            return
        }

        const initialCommitResult: 'Success' | 'GitAddFailed' | 'GitCommitFailed' =
            await this.createInitialCommit(projectFolder)
        if (initialCommitResult !== 'Success') {
            return
        }

        await ProjectInitializationProvider.openNewFolder(projectFolder)
    }

    private async createProject(
        kind?: string | undefined,
        toolchain: string = 'leanprover/lean4:stable',
    ): Promise<FileUri | 'DidNotComplete'> {
        const projectFolder: FileUri | undefined = await ProjectInitializationProvider.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: 'Create a new project folder',
        })
        if (projectFolder === undefined) {
            return 'DidNotComplete'
        }

        await workspace.fs.createDirectory(projectFolder.asUri())

        const preconditionCheckResult = await checkLean4ProjectInitPreconditions(this.installer, projectFolder)
        if (preconditionCheckResult === PreconditionCheckResult.Fatal) {
            return 'DidNotComplete'
        }

        const projectName: string = path.basename(projectFolder.fsPath)
        const result: ExecutionResult = await lake(this.channel, projectFolder, toolchain).initProject(
            projectName,
            kind,
        )
        if (result.exitCode !== ExecutionExitCode.Success) {
            displayResultError(result, 'Cannot initialize project.')
            return 'DidNotComplete'
        }

        const updateResult: ExecutionResult = await lake(this.channel, projectFolder, toolchain).updateDependencies()
        if (updateResult.exitCode === ExecutionExitCode.Cancelled) {
            return 'DidNotComplete'
        }
        if (updateResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(updateResult, 'Cannot update dependencies.')
            return 'DidNotComplete'
        }

        return projectFolder
    }

    private async createInitialCommit(projectFolder: FileUri): Promise<'Success' | 'GitAddFailed' | 'GitCommitFailed'> {
        const gitAddResult = await batchExecute('git', ['add', '--all'], projectFolder.fsPath, {
            combined: this.channel,
        })
        if (gitAddResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(gitAddResult, 'Cannot add files to staging area of Git repository for project.')
            return 'GitAddFailed'
        }

        const gitCommitResult = await batchExecute(
            'git',
            ['commit', '--author', 'Lean 4 VS Code Extension <>', '-m', 'Initial commit'],
            projectFolder.fsPath,
            { combined: this.channel },
        )
        if (gitCommitResult.exitCode !== ExecutionExitCode.Success) {
            displayResultError(gitAddResult, 'Cannot commit files to Git repository for project.')
            return 'GitCommitFailed'
        }

        return 'Success'
    }

    private async openProject() {
        const projectFolders: Uri[] | undefined = await window.showOpenDialog({
            title: "Open Lean 4 project folder containing a 'lean-toolchain' file",
            openLabel: 'Open project folder',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
        })
        if (projectFolders === undefined || projectFolders.length !== 1) {
            return
        }

        const projectFolderUri = projectFolders[0]
        if (!(await ProjectInitializationProvider.checkIsFileUriOrShowError(projectFolderUri))) {
            return
        }
        let projectFolder = new FileUri(projectFolderUri.fsPath)

        if (!(await isValidLeanProject(projectFolder))) {
            const parentProjectFolder: FileUri | undefined =
                await ProjectInitializationProvider.attemptFindingLeanProjectInParentFolder(projectFolder)
            if (parentProjectFolder === undefined) {
                return
            }
            projectFolder = parentProjectFolder
        }

        const preconditionCheckResult = await checkLean4ProjectInitPreconditions(this.installer, projectFolder)
        if (preconditionCheckResult === PreconditionCheckResult.Fatal) {
            return
        }

        // This kills the extension host, so it has to be the last command
        await commands.executeCommand('vscode.openFolder', projectFolder.asUri())
    }

    private static async attemptFindingLeanProjectInParentFolder(projectFolder: FileUri): Promise<FileUri | undefined> {
        const parentProjectFolder: FileUri | undefined = await checkParentFoldersForLeanProject(projectFolder)
        if (parentProjectFolder === undefined) {
            const message = `The selected folder is not a valid Lean 4 project folder.
Please make sure to select a folder containing a \'lean-toolchain\' file.
Click the following link to learn how to set up Lean projects: [(Show Setup Guide)](command:lean4.setup.showSetupGuide)`
            displayError(message)
            return undefined
        }

        const message = `The selected folder is not a valid Lean 4 project folder because it does not contain a 'lean-toolchain' file.
However, a valid Lean 4 project folder was found in one of the parent directories at '${parentProjectFolder.fsPath}'.
Open this project instead?`
        const input = 'Open parent directory project'
        const choice: string | undefined = await displayInformationWithInput(message, input)
        if (choice !== input) {
            return undefined
        }

        return parentProjectFolder
    }

    private async cloneProject() {
        const projectUri: string | undefined = await window.showInputBox({
            title: 'URL Input',
            value: 'https://github.com/leanprover-community/mathlib4',
            prompt: 'URL of Git repository for existing Lean 4 project',
        })
        if (projectUri === undefined) {
            return
        }

        const projectFolder: FileUri | undefined = await ProjectInitializationProvider.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: 'Create a new project folder to clone existing Lean 4 project into',
        })
        if (projectFolder === undefined) {
            return
        }

        await workspace.fs.createDirectory(projectFolder.asUri())

        const preconditionCheckResult = await checkLean4ProjectInitPreconditions(this.installer, projectFolder)
        if (preconditionCheckResult === PreconditionCheckResult.Fatal) {
            return
        }

        const result: ExecutionResult = await batchExecuteWithProgress(
            'git',
            ['clone', projectUri, projectFolder.fsPath],
            'Cloning project',
            { channel: this.channel, allowCancellation: true },
        )
        if (result.exitCode === ExecutionExitCode.Cancelled) {
            return
        }
        if (result.exitCode !== ExecutionExitCode.Success) {
            displayResultError(result, 'Cannot download project.')
            return
        }

        // Try it. If this is not a mathlib project, it will fail silently. Otherwise, it will grab the cache.
        const fetchResult: ExecutionResult = await lake(this.channel, projectFolder).fetchMathlibCache(true)
        if (fetchResult.exitCode === ExecutionExitCode.Cancelled) {
            return
        }

        await ProjectInitializationProvider.openNewFolder(projectFolder)
    }

    private static async askForNewProjectFolderLocation(options: SaveDialogOptions): Promise<FileUri | undefined> {
        const projectFolder: Uri | undefined = await window.showSaveDialog(options)
        if (projectFolder === undefined || !(await this.checkIsFileUriOrShowError(projectFolder))) {
            return undefined
        }
        return new FileUri(projectFolder.fsPath)
    }

    private static async checkIsFileUriOrShowError(projectFolder: Uri): Promise<boolean> {
        if (projectFolder.scheme === 'file') {
            return true
        } else {
            displayError('Project folder must be created in a file system.')
            return false
        }
    }

    private static async openNewFolder(projectFolder: FileUri) {
        const message = `Project initialized. Open new project folder '${path.basename(projectFolder.fsPath)}'?`
        const input = 'Open project folder'
        const choice: string | undefined = await displayInformationWithInput(message, input)
        if (choice === input) {
            // This kills the extension host, so it has to be the last command
            await commands.executeCommand('vscode.openFolder', projectFolder.asUri())
        }
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
