import * as fs from 'fs';
import { URL } from 'url';
import { EventEmitter, Disposable, Uri, workspace, window } from 'vscode';
import { LocalStorageService} from './localStorage'

export class LeanpkgService implements Disposable {
    private subscriptions: Disposable[] = [];
    private leanVersionFile : Uri = null;
    private toolchainFileName : string = 'lean-toolchain'
    private tomlFileName : string = 'leanpkg.toml'
    private defaultVersion = 'leanprover/lean4:nightly';
    private localStorage : LocalStorageService;
    private versionChangedEmitter = new EventEmitter<string>();
    versionChanged = this.versionChangedEmitter.event

    constructor(localStorage : LocalStorageService) {
        this.localStorage = localStorage;

        // track changes in the version of lean specified in the .toml file...
        const watcher = workspace.createFileSystemWatcher('**/leanpkg.toml');
        watcher.onDidChange((u) => this.handleFileChanged(u));
        watcher.onDidCreate((u) => this.handleFileChanged(u));
        watcher.onDidDelete((u) => this.handleFileDeleted(u));
        this.subscriptions.push(watcher);

        const watcher2 = workspace.createFileSystemWatcher('**/lean-toolchain');
        watcher2.onDidChange((u) => this.handleFileChanged(u));
        watcher2.onDidCreate((u) => this.handleFileChanged(u));
        watcher2.onDidDelete((u) => this.handleFileDeleted(u));
    }

    private isLean(languageId : string) : boolean {
        return languageId === 'lean' || languageId === 'lean4';
    }

    getWorkspaceLeanFolderUri() : Uri {
        let rootPath : Uri = null;

        if (window.activeTextEditor && this.isLean(window.activeTextEditor.document.languageId))
        {
            rootPath = window.activeTextEditor.document.uri;
        }
        else {
            // This happens if vscode starts with a lean file open
            // but the "Getting Started" page is active.
            for (const editor of window.visibleTextEditors) {
                const lang = editor.document.languageId;
                if (this.isLean(lang)) {
                    rootPath = editor.document.uri;
                    break;
                }
            }
        }

        if (rootPath) {
            return Uri.joinPath(rootPath, '..');
        }

        // this code path should never happen because lean extension is only
        // activated when a lean file is opened, so it should have been in the
        // list of window.visibleTextEditors.
        const workspaceFolders = workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            rootPath = workspaceFolders[0].uri;
        }
        if (!rootPath) {
            return null;
        }
        return rootPath;
    }

    async findLeanPkgVersionInfo() : Promise<string> {
        const path = this.getWorkspaceLeanFolderUri()
        if (!path) {
            // what kind of vs folder is this?
        }
        else {
            let uri = path;
            // search parent folders for a leanpkg.toml file, or a Lake lean-toolchain file.
            while (true) {
                const leanToolchain = Uri.joinPath(uri, this.toolchainFileName);
                if (fs.existsSync(new URL(leanToolchain.toString()))) {
                    this.leanVersionFile = leanToolchain;
                    break;
                }
                else {
                    const leanPkg = Uri.joinPath(uri, this.tomlFileName);
                    if (fs.existsSync(new URL(leanPkg.toString()))) {
                        this.leanVersionFile = leanPkg;
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
        }

        let version = this.defaultVersion;
        if (this.leanVersionFile || this.leanVersionFile) {
            try {
                version = await this.readLeanVersion();
            } catch (err) {
                console.log(err);
            }
        }

        return version;
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private async handleFileChanged(uri: Uri) {
        if (!this.leanVersionFile){
            this.leanVersionFile = uri;
        }
        if (uri.toString() === this.leanVersionFile.toString()) {
            const version = await this.readLeanVersion();
            this.localStorage.setLeanVersion('');
            // raise an event so the extension triggers handleVersionChanged.
            this.versionChangedEmitter.fire(version);
        }
    }

    private async handleFileDeleted(uri: Uri) {
        if (this.leanVersionFile && uri.toString() === this.leanVersionFile.toString()){
            this.leanVersionFile = null;
            // user might be switching from leanpkg to lake...
            const version = await this.findLeanPkgVersionInfo();
            this.versionChangedEmitter.fire(version ?? this.defaultVersion);
        }
    }

    private async readLeanVersion() {
        if (this.leanVersionFile.path.endsWith(this.tomlFileName))
        {
            const url = new URL(this.leanVersionFile.toString());
            return new Promise<string>((resolve, reject) => {
                if (fs.existsSync(url)) {
                    fs.readFile(url, { encoding: 'utf-8' }, (err, data) =>{
                        if (err) {
                            reject(err);
                        } else {
                            let version = this.defaultVersion;
                            const match = /lean_version\s*=\s*"([^"]*)"/.exec(data.toString());
                            if (match) version = match[1];
                            resolve(version);
                        }
                    });
                } else {
                    resolve(this.defaultVersion);
                }
            });
        } else {
            // must be a lean-toolchain file, these are much simpler they only contain a version.
            const url = new URL(this.leanVersionFile.toString());
            return new Promise<string>((resolve, reject) => {
                if (fs.existsSync(url)) {
                    fs.readFile(url, { encoding: 'utf-8' }, (err, data) =>{
                        if (err) {
                            reject(err);
                        } else {
                            const version = data.trim() ?? this.defaultVersion;
                            resolve(version);
                        }
                    });
                } else {
                    resolve(this.defaultVersion);
                }
            });
        }
    }
}
