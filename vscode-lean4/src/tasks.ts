import { CancellationToken, ProviderResult, ShellExecution, Task, TaskProvider, TaskScope, TaskDefinition, TaskRevealKind, tasks, Disposable } from 'vscode'

export const leanTaskDefinition: TaskDefinition = { type: 'lean4' }

export interface LeanTask {
    command: string
    description: string
}

export function createExecutableTask(task: LeanTask, reveal: TaskRevealKind = TaskRevealKind.Always, cwd?: string | undefined): Task {
    const env = Object.entries(process.env)
        .filter(([_, value]) => value !== undefined)
        .reduce((obj, [key, value]) => {
            obj[key] = value as string;
            return obj;
        }, {} as {[key: string]: string});

    const t = new Task(
        leanTaskDefinition,
        TaskScope.Workspace,
        task.description,
        'Lean 4',
        new ShellExecution(task.command, { cwd, env }),
        ''
    )
    t.presentationOptions.reveal = reveal
    return t
}

export async function runTaskUntilCompletion(task: Task, subscriptions: Disposable[]): Promise<void> {
    const execution = await tasks.executeTask(task)
    return new Promise((resolve, reject) => {
        tasks.onDidEndTaskProcess(async e => {
            if (e.execution !== execution) {
                return
            }

            if (e.exitCode === 0) {
                resolve()
            } else {
                reject(e.exitCode)
            }
        }, undefined, subscriptions)
    })
}

export const initLibraryProjectTask: LeanTask = {
    command: 'lake init ${workspaceFolderBasename} lib',
    description: 'Initialize Lean 4 library project in current folder'
}
export const initProgramProjectTask: LeanTask = {
    command: 'lake init ${workspaceFolderBasename} exe',
    description: 'Initialize Lean 4 program project in current folder'
}
export const initMathlibProjectTask: LeanTask = {
    command: 'lake +leanprover-community/mathlib4:lean-toolchain init ${workspaceFolderBasename} math',
    description: 'Initialize Lean 4 math formalization project in current folder'
}
export const buildTask: LeanTask = {
    command: 'lake build',
    description: 'Build Lean 4 project'
}
export const cleanTask: LeanTask = {
    command: 'lake clean',
    description: 'Clean build artifacts of Lean 4 project'
}
export const cacheGetTask: LeanTask = {
    command: 'lake exe cache get',
    description: '⚠ Mathlib command ⚠: Download cached Mathlib build artifacts'
}
export const updateTask: LeanTask = {
    command: 'lake update',
    description: '⚠ Project maintenance command ⚠: Upgrade all project dependencies'
}

export class LeanTaskProvider implements TaskProvider {

    provideTasks(token: CancellationToken): ProviderResult<Task[]> {
        return [
            createExecutableTask(initLibraryProjectTask, TaskRevealKind.Silent),
            createExecutableTask(initProgramProjectTask, TaskRevealKind.Silent),
            createExecutableTask(initMathlibProjectTask, TaskRevealKind.Silent),
            createExecutableTask(buildTask),
            createExecutableTask(cleanTask),
            createExecutableTask(cacheGetTask),
            createExecutableTask(updateTask)
        ]
    }

    resolveTask(task: Task, token: CancellationToken): ProviderResult<Task> {
        return undefined
    }

}
