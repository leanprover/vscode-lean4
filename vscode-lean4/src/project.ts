import * as vscode from 'vscode';
import { Disposable, TaskRevealKind, Uri, commands, window, workspace, SaveDialogOptions } from 'vscode';
import { LeanTask, buildTask, cacheGetTask, cleanTask, createExecutableTask, runTaskUntilCompletion, updateTask } from './tasks';
import path = require('path');


export class ProjectOperationProvider implements Disposable {

    private subscriptions: Disposable[] = [];

    constructor() {
        this.subscriptions.push(
            commands.registerCommand('lean4.createLibraryProject', () => this.createLibraryProject()),
            commands.registerCommand('lean4.createProgramProject', () => this.createProgramProject()),
            commands.registerCommand('lean4.createMathlibProject', () => this.createMathlibProject()),
            commands.registerCommand('lean4.cloneProject', () => this.cloneProject()),
            commands.registerCommand('lean4.buildProject', () => this.buildProject()),
            commands.registerCommand('lean4.cleanProject', () => this.cleanProject()),
            commands.registerCommand('lean4.mathlib.fetchCache', () => this.fetchMathlibCache())
        )
    }

    private async createLibraryProject() {
        await this.createProject('lib', 'library')
    }

    private async createProgramProject() {
        await this.createProject('exe', 'program')
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

        const projectFolder: Uri | undefined = await this.askForNewProjectFolderLocation({
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

        const tasks = postProcessingTasks.slice()
        tasks.unshift(createProjectTask)
        for (const task of tasks) {
            try {
                await runTaskUntilCompletion(createExecutableTask(task, TaskRevealKind.Always, projectFolder.fsPath), this.subscriptions)
            } catch (e) {
                return // error will already be displayed in terminal
            }
        }

        await this.openFolder(projectFolder)
    }

    private async cloneProject() {
        const unparsedProjectUri: string | undefined = await window.showInputBox({
            title: 'URL Input',
            value: 'https://github.com/leanprover-community/mathlib4',
            prompt: 'URL of Git repository for existing Lean 4 project',
            validateInput: value => {
                try {
                    Uri.parse(value, true)
                    return undefined // valid URI
                } catch (e) {
                    return 'Invalid URL'
                }
            }
        })
        if (unparsedProjectUri === undefined) {
            return
        }
        const existingProjectUri = Uri.parse(unparsedProjectUri)

        const projectFolder: Uri | undefined = await this.askForNewProjectFolderLocation({
            saveLabel: 'Create project folder',
            title: 'Create a new project folder to clone existing project into'
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
            return // error will already be displayed in terminal
        }

        await this.openFolder(projectFolder)
    }

    private async askForNewProjectFolderLocation(options: SaveDialogOptions): Promise<Uri | undefined> {
        const projectFolder: Uri | undefined = await window.showSaveDialog(options)
        if (projectFolder === undefined) {
            return undefined
        }
        if (projectFolder.scheme !== 'file') {
            await window.showErrorMessage('Project folder must be created in a file system.')
            return undefined
        }
        return projectFolder
    }

    private async openFolder(projectFolder: Uri) {
        const message: string = `
            Project initialized. Open new project folder '${path.basename(projectFolder.fsPath)}'?
            Unsaved file contents will be lost.
        `
        const choice: string | undefined = await window.showWarningMessage(message, { modal: true }, 'Open project folder')
        if (choice === 'Open project folder') {
            // this kills the extension host, so it has to be the last command
            await commands.executeCommand('vscode.openFolder', projectFolder)
        }
    }

    private async buildProject() {
        await vscode.tasks.executeTask(createExecutableTask(buildTask))
    }

    private async cleanProject() {
        const choice: string | undefined = await window.showWarningMessage('Delete all build artifacts?', { modal: true }, 'Proceed')

        if (choice === 'Proceed') {
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
