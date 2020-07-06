import * as fs from 'fs';
import * as path from 'path';
import { commands, Disposable, extensions, ProcessExecution, Task, TaskGroup,
    TaskProvider, Uri, window, workspace } from 'vscode';
import { Server } from './server';

export class LeanpkgService implements TaskProvider, Disposable {
    private leanpkgPathContents: string;
    private subscriptions: Disposable[] = [];
    private leanpkgToml = path.join(workspace.rootPath, 'leanpkg.toml');
    private leanpkgPath = path.join(workspace.rootPath, 'leanpkg.path');

    constructor(private server: Server) {
        void this.checkLeanpkgPathFile();
        void this.checkLeanpkgPathContents();
        this.subscriptions.push(workspace.registerTaskProvider('leanpkg', this));

        const watcher = workspace.createFileSystemWatcher('**/leanpkg.*');
        watcher.onDidChange((u) => this.handleFileChanged(u));
        watcher.onDidCreate((u) => this.handleFileChanged(u));
        watcher.onDidDelete((u) => this.handleFileChanged(u));
        this.subscriptions.push(watcher);
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private async handleFileChanged(uri: Uri) {
        if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.toml')) {
            await this.checkLeanpkgPathFile();
        } else if (uri.fsPath === path.join(workspace.rootPath, 'leanpkg.path')) {
            await this.checkLeanpkgPathContents(true);
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

        const {extensionPath} = extensions.getExtension('jroesch.lean');
        const leanpkg = config.get<string>('leanpkgPath').replace('%extensionPath%', extensionPath + '/');
        if (leanpkg) { return leanpkg; }

        const leanPath = config.get<string>('executablePath').replace('%extensionPath%', extensionPath + '/');
        if (leanPath) {
            const leanpkg2 = path.join(path.dirname(leanPath), 'leanpkg');
            if (fs.existsSync(leanpkg2)) { return leanpkg2; }
        }

        return 'leanpkg';
    }

    private async checkLeanpkgPathContents(promptForRestart?: boolean) {
        const oldContents = this.leanpkgPathContents;
        this.leanpkgPathContents = fs.existsSync(this.leanpkgPath) &&
            fs.readFileSync(this.leanpkgPath).toString();
        if (oldContents !== this.leanpkgPathContents && promptForRestart) {
            await this.server.requestRestart('Lean: leanpkg.path changed.', true);
        }
    }

    private async checkLeanpkgPathFile() {
        if (!fs.existsSync(this.leanpkgToml) && !fs.existsSync(this.leanpkgPath)) {
            const leanFiles = await workspace.findFiles('**/*.lean', undefined, 1);
            // Only show warning if there are Lean files, see https://github.com/leanprover/vscode-lean/issues/133
            // (The extension is also activated for Markdown files.)
            if (leanFiles.length === 0) return;

            let folder = workspace.rootPath;
            while (true) {
                const parent = path.dirname(folder);
                if (parent === folder) break;
                if (!fs.existsSync(path.join(parent, 'leanpkg.toml'))) {
                    folder = parent;
                    continue;
                }

                const ok = 'Switch to correct folder';
                const admonition =
                    'You are running Lean in a directory without a leanpkg.toml file, this is NOT ' +
                    'supported.  Please switch to the folder containing the leanpkg.toml file ' +
                    `instead (which is ${parent}).  You can also do this manually using "File / Open Folder...".`;
                const clicked = await window.showErrorMessage(admonition, {modal: true}, ok);
                if (clicked === ok) {
                    workspace.updateWorkspaceFolders(0, 1, { uri: Uri.file(parent) });
                }
                return;
            }

            await window.showWarningMessage(`
You are running Lean in a directory without a leanpkg.toml file, this is NOT
supported.  Please open the directory containing the leanpkg.toml file
instead (using "File / Open Folder..."). [More details
here](https://leanprover-community.github.io/install/project.html)`);
        } else if (!fs.existsSync(this.leanpkgPath)) {
            await this.requestLeanpkgConfigure('Lean: leanpkg.path does not exist');
        } else if (fs.statSync(this.leanpkgPath) < fs.statSync(this.leanpkgToml)) {
            await this.requestLeanpkgConfigure('Lean: leanpkg.path out of date');
        }
    }

    private async requestLeanpkgConfigure(message: string) {
        const configureItem = 'Run leanpkg configure.';
        const chosen = await window.showErrorMessage(message, configureItem);
        if (chosen === configureItem) {
            await this.configure();
        }
    }

    private async configure() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: configure');
    }

    private async build() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: build');
    }

    private async upgrade() {
        await commands.executeCommand('workbench.action.tasks.runTask',
            'leanpkg: upgrade');
    }
}
