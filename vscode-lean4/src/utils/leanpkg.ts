import * as fs from 'fs';
import { URL } from 'url';
import { EventEmitter, Disposable, Uri, workspace, window } from 'vscode';
import { LocalStorageService} from './localStorage'

export class LeanpkgService implements Disposable {
    private subscriptions: Disposable[] = [];
    private leanVersionFile : Uri = null;
    private toolchainFileName : string = 'lean-toolchain'
    private tomlFileName : string = 'leanpkg.toml'
    private lakeFileName : string = 'lakefile.lean'
    private defaultToolchain : string;
    private localStorage : LocalStorageService;
    private versionChangedEmitter = new EventEmitter<string>();
    private lakeFileChangedEmitter = new EventEmitter();
    private currentVersion : string = null;
    private currentLakeFileContents : string = null;

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

    private isLean(languageId : string) : boolean {
        return languageId === 'lean' || languageId === 'lean4';
    }

    getWorkspaceLeanFolderUri() : Uri {
        let documentUri : Uri = null;

        if (window.activeTextEditor)
        {
            documentUri = window.activeTextEditor.document.uri
        }
        else {
            // This happens if vscode starts with a lean file open
            // but the "Getting Started" page is active.
            for (const editor of window.visibleTextEditors) {
                const lang = editor.document.languageId;
                if (this.isLean(lang)) {
                    documentUri = editor.document.uri;
                    break;
                }
            }
        }

        let rootPath : Uri = null;
        if (documentUri) {
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
            // this code path should never happen because lean extension is only
            // activated when a lean file is opened, so it should have been in the
            // list of window.visibleTextEditors.  So this is a fallback just in
            // case some weird timing thing happened and file is now closed.
            const workspaceFolders = workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                rootPath = workspaceFolders[0].uri;
            }
        }

        if (!rootPath) {
            return null;
        }
        return rootPath;
    }

    async readLakeFile() : Promise<string> {
        const uri = this.getWorkspaceLeanFolderUri()
        if (!uri || uri.fsPath === '.') {
            // this is a "new file" that has not been saved yet.
            return "";
        }
        const localFile = Uri.joinPath(uri, this.lakeFileName);
        const url = new URL(localFile.toString())
        if (fs.existsSync(url)) {
            let contents = fs.readFileSync(url).toString();
            // ignore whitespace changes by normalizing whitespace.
            const re = /[ \t\r\n]+/g
            const result = contents.replace(re, ' ');
            return result.trim();
        }
    }

    async findLeanPkgVersionInfo() : Promise<string> {
        const path = this.getWorkspaceLeanFolderUri()
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

        if (this.currentLakeFileContents === null){
            this.currentLakeFileContents = await this.readLakeFile();
        }

        return version;
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private async handleLakeFileChanged(uri : Uri) {
        // Note: just opening the file fires this event sometimes which is annoying, so
        // we compare the contents just to be sure.
        const contents = await this.readLakeFile();
        if (contents !== this.currentLakeFileContents) {
            this.currentLakeFileContents = contents;
            console.log("Lake file changed...")
            this.lakeFileChangedEmitter.fire(undefined);
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
        const version = await this.findLeanPkgVersionInfo();
        if (version && version !== current) {
            // raise an event so the extension triggers handleVersionChanged.
            this.versionChangedEmitter.fire(this.currentVersion);
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
