import * as fs from 'fs';
import * as path from 'path';
import { commands, Disposable, ProcessExecution, Task, TaskDefinition, TaskGroup, TaskProvider, Uri,
    window, workspace } from 'vscode';
import { Server } from './server';

export class LeanpkgService implements TaskProvider, Disposable {
    private subscriptions: Disposable[] = [];

    constructor(private server: Server) {
        this.checkLeanpkgPathFile();
        this.subscriptions.push(workspace.registerTaskProvider('leanpkg', this));

        const watcher = workspace.createFileSystemWatcher('**/leanpkg.*');
        watcher.onDidChange((u) => this.handleFileChanged(u));
        watcher.onDidCreate((u) => this.handleFileChanged(u));
        watcher.onDidDelete((u) => this.handleFileChanged(u));
        this.subscriptions.push(watcher);
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private handleFileChanged(uri: Uri) {
        if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.toml')) {
            this.checkLeanpkgPathFile();
        } else if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.path')) {
            this.server.requestRestart('Lean: leanpkg.path changed.', true);
        }
    }

    private mkTask(command: string): Task {
        const task = new Task({ type: 'leanpkg', command }, command, 'leanpkg',
            new ProcessExecution(this.leanpkgExecutable(), [command]), []);
        task.group = TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            focus: true,
        };
        return task;
    }

    provideTasks(): Task[] {
        return ['build', 'configure', 'upgrade'].map((c) => this.mkTask(c));
    }
    resolveTask(task: Task): Task {
        return undefined;
    }

    leanpkgExecutable(): string {
        const config = workspace.getConfiguration('lean');

        const leanpkg = config.get<string>('leanpkgPath');
        if (leanpkg) { return leanpkg; }

        const leanPath = config.get<string>('executablePath');
        if (leanPath) {
            const leanpkg2 = path.join(path.dirname(leanPath), 'lean');
            if (fs.existsSync(leanpkg2)) { return leanpkg2; }
        }

        return 'leanpkg';
    }

    checkLeanpkgPathFile() {
        const leanpkgToml = path.join(workspace.rootPath, 'leanpkg.toml');
        const leanpkgPath = path.join(workspace.rootPath, 'leanpkg.path');

        if (!fs.existsSync(leanpkgToml)) {
            // TODO(gabriel): encourage users to use leanpkg
        } else if (!fs.existsSync(leanpkgPath)) {
            this.requestLeanpkgConfigure('Lean: leanpkg.path does not exist');
        } else if (fs.statSync(leanpkgPath) < fs.statSync(leanpkgToml)) {
            this.requestLeanpkgConfigure('Lean: leanpkg.path out of date');
        }
    }

    async requestLeanpkgConfigure(message: string) {
        const configureItem = 'Run leanpkg configure.';
        const chosen = await window.showErrorMessage(message, configureItem);
        if (chosen === configureItem) {
            await this.configure();
        }
    }

    async configure() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: configure');
    }

    async build() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: build');
    }

    async upgrade() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: upgrade');
    }
}
