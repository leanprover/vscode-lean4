import * as vscode from 'vscode';
import { Disposable, TaskRevealKind, Uri, commands, window, workspace, SaveDialogOptions, FileType } from 'vscode';
import { LeanTask, buildTask, cacheGetTask, cleanTask, createExecutableTask, runTaskUntilCompletion, updateElanTask, updateTask } from './tasks';
import path = require('path');
import { checkParentFoldersForLeanProject, isValidLeanProject } from './utils/projectInfo';

export class ProjectOperationProvider implements Disposable {

    private subscriptions: Disposable[] = [];

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
        await this.createProject('lib', 'library', 'stable')
    }

    private async createProgramProject() {
        await this.createProject('exe', 'program', 'stable')
    }

    private async createMathlibProject() {
        await this.createProject('math', 'math formalization',
            'leanprover-community/mathlib4:lean-toolchain',
            [updateTask, cacheGetTask])
    }

    private async createProject(
        kind: string,
        kindName: string,
        toolchain?: string | undefined,
        postProcessingTasks: LeanTask[] = []) {

        const projectFolder: Uri | undefined = await ProjectOperationProvider.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: `Create a new ${kindName} project folder`
        })
        if (projectFolder === undefined) {
            return
        }

        await workspace.fs.createDirectory(projectFolder)

        const projectName: string = path.basename(projectFolder.fsPath)
        const initCommand: string =
            toolchain === undefined
                ? 'init'
                : `+${toolchain} init`
        const createProjectTask: LeanTask = {
            command: `lake ${initCommand} "${projectName}" ${kind}`,
            description: `Create new Lean 4 ${kindName} project`
        }

        const tasks = [updateElanTask, createProjectTask].concat(postProcessingTasks)
        for (const task of tasks) {
            try {
                await runTaskUntilCompletion(createExecutableTask(task, TaskRevealKind.Always, projectFolder.fsPath), this.subscriptions)
            } catch (e) {
                return // Error will already be displayed in terminal
            }
        }

        await ProjectOperationProvider.openNewFolder(projectFolder)
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
            await window.showErrorMessage('The selected folder is not a valid Lean 4 project folder. Please make sure to select a folder containing a \'lean-toolchain\' file.')
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

        try {
            await runTaskUntilCompletion(createExecutableTask({
                command: `git clone "${existingProjectUri}" "${projectFolder.fsPath}"`,
                description: 'Download existing Lean 4 project using `git clone`'
            }), this.subscriptions)
        } catch (e) {
            return // Error will already be displayed in terminal
        }

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
            await window.showErrorMessage('Project folder must be created in a file system.')
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
        await vscode.tasks.executeTask(createExecutableTask(buildTask))
    }

    private async cleanProject() {
        const input = 'Proceed'
        const choice: string | undefined = await window.showInformationMessage('Delete all build artifacts?', { modal: true }, input)

        if (choice === input) {
            await vscode.tasks.executeTask(createExecutableTask(cleanTask))
        }
    }

    private async fetchMathlibCache() {
        await vscode.tasks.executeTask(createExecutableTask(cacheGetTask))
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

}
