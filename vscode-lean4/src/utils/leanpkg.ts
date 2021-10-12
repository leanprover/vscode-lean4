import * as fs from 'fs';
import { URL } from 'url';
import { EventEmitter, Disposable, Uri, workspace } from 'vscode';

export class LeanpkgService implements Disposable {
    private leanVersion: string;
    private subscriptions: Disposable[] = [];
    private leanpkgToml : Uri = null;
    private tomlFileName : string = 'leanpkg.toml'
    private defaultVersion = 'leanprover/lean4:nightly';

    private versionChangedEmitter = new EventEmitter<string>();
    versionChanged = this.versionChangedEmitter.event

    constructor() {
        this.leanVersion = this.defaultVersion;
    }

    async findLeanPkgVersionInfo() : Promise<string> {
        const workspaceFolders = workspace.workspaceFolders;
        let rootPath : Uri = null;
        // TODO: support multiple workspace folders?
        if (workspaceFolders && workspaceFolders.length > 0){
            rootPath = workspaceFolders[0].uri;
        }
        if (!rootPath) {
            // what kind of vs folder is this?
        }
        else {
            let uri = rootPath;
            // search parent folders for a leanpkg.toml file...
            while (true) {
                const fileUri = Uri.joinPath(uri, this.tomlFileName);
                if (fs.existsSync(new URL(fileUri.toString()))) {
                    this.leanpkgToml = fileUri;
                    break;
                }
                else {
                    const parent = Uri.joinPath(uri, '..');
                    if (parent === uri) {
                        // no .toml file found.
                        break;
                    }
                    uri = parent;
                }
            }
        }

        if (this.leanpkgToml) {
            try {
                this.leanVersion = await this.readLeanVersion(this.leanpkgToml);
            } catch (err) {
                console.log(err);
            }
        }

        // track changes in the version of lean specified in the .toml file...
        const watcher = workspace.createFileSystemWatcher('**/leanpkg.toml');
        watcher.onDidChange((u) => this.handleFileChanged(u));
        watcher.onDidCreate((u) => this.handleFileChanged(u));
        watcher.onDidDelete((u) => this.handleFileChanged(u));
        this.subscriptions.push(watcher);

        return this.leanVersion;
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private async handleFileChanged(uri: Uri) {
        if (!this.leanpkgToml){
            this.leanpkgToml = uri;
        }
        if (uri.toString() === this.leanpkgToml.toString()) {
            const version = await this.readLeanVersion(uri);
            if (version !== this.leanVersion){
                // raise an event so that LeanClient can trigger a restart.
                this.leanVersion = version;
                this.versionChangedEmitter.fire(version);
            }
        }
    }

    private trimQuotes(s : string) : string {
        s = s.trim();
        if (s.startsWith('"')){
            s = s.substring(1);
        }
        if (s.endsWith('"')){
            s = s.substring(0, s.length - 1);
        }
        return s;
    }

    private async readLeanVersion(fileUri: Uri){
        const url = new URL(fileUri.toString());
        return new Promise<string>((resolve, reject) => {
            if (fs.existsSync(url)) {
                fs.readFile(url, { encoding: 'utf-8' }, (err, data) =>{
                    if (err) {
                        reject(err);
                    } else {
                        let version = this.defaultVersion;
                        const lines = data.split(/\r?\n/);
                        lines.forEach((line) =>{
                            if (line.trim().startsWith('lean_version')){
                                const p = line.split('=');
                                if (p.length > 1){
                                    version = this.trimQuotes(p[1]);
                                }
                            }
                        });
                        resolve(version);
                    }
                });
            } else {
                resolve(this.defaultVersion);
            }
        });
    }

    // TODO: this task part is TBD...
    // private mkTask(command: string): Task {
    //     const task = new Task({ type: 'leanpkg', command }, command, 'leanpkg',
    //         new ProcessExecution(this.leanpkgExecutable(), [command]), []);
    //     task.group = TaskGroup.Build;
    //     task.presentationOptions = {
    //         echo: true,
    //         focus: true,
    //     };
    //     return task;
    // }

    // provideTasks(): Task[] {
    //     return ['build', 'configure', 'upgrade'].map((c) => this.mkTask(c));
    // }
    // resolveTask(task: Task): Task {
    //     return undefined;
    // }

    // leanpkgExecutable(): string {
    //     const config = workspace.getConfiguration('lean4');

    //     let executable = this.storageManager.getLeanPath();
    //     if (!executable) executable = executablePath();

    //     const {extensionPath} = extensions.getExtension('jroesch.lean');
    //     const leanpkg = config.get<string>('leanpkgPath').replace('%extensionPath%', extensionPath + '/');
    //     if (leanpkg) { return leanpkg; }

    //     const leanPath = config.get<string>('executablePath').replace('%extensionPath%', extensionPath + '/');
    //     if (leanPath) {
    //         const leanpkg2 = path.join(path.dirname(leanPath), 'leanpkg');
    //         if (fs.existsSync(leanpkg2)) { return leanpkg2; }
    //     }

    //     return 'leanpkg';
    // }

    // private async requestLeanpkgConfigure(message: string) {
    //     const configureItem = 'Run leanpkg configure.';
    //     const chosen = await window.showErrorMessage(message, configureItem);
    //     if (chosen === configureItem) {
    //         await this.configure();
    //     }
    // }

    // private async configure() {
    //     await commands.executeCommand('workbench.action.tasks.runTask',
    //         'leanpkg: configure');
    // }

    // private async build() {
    //     await commands.executeCommand('workbench.action.tasks.runTask',
    //         'leanpkg: build');
    // }

    // private async upgrade() {
    //     await commands.executeCommand('workbench.action.tasks.runTask',
    //         'leanpkg: upgrade');
    // }
}
