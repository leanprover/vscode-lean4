import * as fs from 'fs';
import { URL } from 'url';
import { EventEmitter, Disposable, Uri, workspace, window, WorkspaceFolder } from 'vscode';
import { LocalStorageService} from './localStorage'

export class LeanpkgService implements Disposable {
    private subscriptions: Disposable[] = [];
    private leanVersionFile : Uri = null;
    private toolchainFileName : string = 'lean-toolchain'
    private tomlFileName : string = 'leanpkg.toml'
    private lakeFileName : string = 'lakefile.lean'
    private defaultToolchain : string;
    private localStorage : LocalStorageService;
    private lakeFileChangedEmitter = new EventEmitter<Uri>();
    private versionChangedEmitter = new EventEmitter<Uri>();
    private currentVersion : string = null;
    private normalizedLakeFileContents : string = null;

    versionChanged = this.versionChangedEmitter.event
    lakeFileChanged = this.lakeFileChangedEmitter.event

    constructor(localStorage : LocalStorageService, defaultToolchain : string) {
        this.localStorage = localStorage;
        this.defaultToolchain = defaultToolchain;
        // track changes in the version of lean specified in the lean-toolchain file
        // or the leanpkg.toml.
        ['**/lean-toolchain', '**/leanpkg.toml'].forEach(pattern => {
            const watcher = workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange((u) => this.handleFileChanged(u));
            watcher.onDidCreate((u) => this.handleFileChanged(u));
            watcher.onDidDelete((u) => this.handleFileChanged(u));
            this.subscriptions.push(watcher);
        });

        const watcher2 = workspace.createFileSystemWatcher(`**/${this.lakeFileName}`);
        watcher2.onDidChange((u) => this.handleLakeFileChanged(u));
        watcher2.onDidCreate((u) => this.handleLakeFileChanged(u));
        watcher2.onDidDelete((u) => this.handleLakeFileChanged(u));
        this.subscriptions.push(watcher2);
    }

    getWorkspaceLeanFolderUri(documentUri: Uri | undefined) : Uri {
        let rootPath : Uri = null;
        if (documentUri) {
            // TODO: do we need to deal with nested workspace folders?
            // According to this sample nested workspaces is a thing...
            // https://github.com/microsoft/vscode-extension-samples
            const folder = workspace.getWorkspaceFolder(documentUri);
            if (folder){
                rootPath = folder.uri;
            }
            if (!rootPath) {
                rootPath = window.activeTextEditor.document.uri;
                if (rootPath) {
                    // remove leaf filename part.
                    rootPath = Uri.joinPath(rootPath, '..');
                }
            }
        }

        if (!rootPath) {
            return null;
        }
        return rootPath;
    }

    async readLakeFile(documentUri: Uri) : Promise<string> {
        const uri = this.getWorkspaceLeanFolderUri(documentUri)
        if (!uri || uri.fsPath === '.') {
            // this is a "new file" that has not been saved yet.
            return '';
        }
        const localFile = Uri.joinPath(uri, this.lakeFileName);
        const url = new URL(localFile.toString())
        if (fs.existsSync(url)) {
            const contents = fs.readFileSync(url).toString();
            // ignore whitespace changes by normalizing whitespace.
            const re = /[ \t\r\n]+/g
            const result = contents.replace(re, ' ');
            return result.trim();
        }
    }

    async findLeanPkgVersionInfo(uri: Uri) : Promise<string> {
        const path = this.getWorkspaceLeanFolderUri(uri)
        if (!path || path.fsPath === '.') {
            // this is a "new file" that has not been saved yet.
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

        let version = null;
        if (this.leanVersionFile || this.leanVersionFile) {
            try {
                version = await this.readLeanVersion();
                this.currentVersion = version;
            } catch (err) {
                console.log(err);
            }
        }

        if (this.normalizedLakeFileContents === null){
            this.normalizedLakeFileContents = await this.readLakeFile(uri);
        }

        return version;
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private async handleLakeFileChanged(uri : Uri) {
        // Note: just opening the file fires this event sometimes which is annoying, so
        // we compare the contents just to be sure and normalize whitespace so that
        // just adding a new line doesn't trigger the prompt.
        const contents = await this.readLakeFile(uri);
        if (contents !== this.normalizedLakeFileContents) {
            this.normalizedLakeFileContents = contents;
            console.log('Lake file changed...')
            this.lakeFileChangedEmitter.fire(uri);
        }
    }

    private async handleFileChanged(uri: Uri) {
        if (this.localStorage.getLeanVersion()){
            // user has a local workspace override in effect, so leave it that way.
            return;
        }
        // note: apply the same rules here with findLeanPkgVersionInfo no matter
        // if a file is added or removed so we always match the elan behavior.
        const current = this.currentVersion;
        // findLeanPkgVersionInfo changes this.currentVersion
        const version = await this.findLeanPkgVersionInfo(uri);
        if (version && version !== current) {
            // raise an event so the extension triggers handleVersionChanged.
            this.versionChangedEmitter.fire(uri);
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
                            let version = this.defaultToolchain;
                            const match = /lean_version\s*=\s*"([^"]*)"/.exec(data.toString());
                            if (match) version = match[1];
                            resolve(version);
                        }
                    });
                } else {
                    resolve(this.defaultToolchain);
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
                            const version = data.trim() ?? this.defaultToolchain;
                            resolve(version);
                        }
                    });
                } else {
                    resolve(this.defaultToolchain);
                }
            });
        }
    }
}
