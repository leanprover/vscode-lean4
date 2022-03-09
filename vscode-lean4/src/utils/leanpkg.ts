import { EventEmitter, Disposable, Uri, workspace, window, WorkspaceFolder } from 'vscode';
import { findLeanPackageRoot, findLeanPackageVersionInfo } from './projectInfo';
import * as path from 'path';
import { fileExists } from './fsHelper';

// This service monitors the Lean package root folders for changes to any
// lean-toolchain, leanpkg.toml or lakefile.lean files found there.
export class LeanpkgService implements Disposable {
    private subscriptions: Disposable[] = [];
    private lakeFileName : string = 'lakefile.lean'
    // We track the current version info for each workspace open in VS code.
    // The key to these maps is the Lean package root Uri.
    private currentVersion : Map<string,string> = new Map();
    private normalizedLakeFileContents : Map<string,string> = new Map();

    // This event is raised when the version in the package root changes.
    // The event provides the lean package root Uri.
    private versionChangedEmitter = new EventEmitter<Uri>();
    versionChanged = this.versionChangedEmitter.event

    // This event is raised if the 'lakefile.lean' file contents is changed.
    // The event provides the lean package root Uri.
    private lakeFileChangedEmitter = new EventEmitter<Uri>();
    lakeFileChanged = this.lakeFileChangedEmitter.event

    constructor() {

        // track changes in the version of lean specified in the lean-toolchain file
        // or the leanpkg.toml.  While this is looking for all files with these names
        // it ignores files that are not in the package root.
        ['**/lean-toolchain', '**/leanpkg.toml'].forEach(pattern => {
            const watcher = workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange((u) => this.handleFileChanged(u, true));
            watcher.onDidCreate((u) => this.handleFileChanged(u, true));
            watcher.onDidDelete((u) => this.handleFileChanged(u, true));
            this.subscriptions.push(watcher);

            const watcher2 = workspace.createFileSystemWatcher(`**/${this.lakeFileName}`);
            watcher2.onDidChange((u) => this.handleLakeFileChanged(u, true));
            watcher2.onDidCreate((u) => this.handleLakeFileChanged(u, true));
            watcher2.onDidDelete((u) => this.handleLakeFileChanged(u, true));
            this.subscriptions.push(watcher);
        });
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    // Must be called when every file is opened so it can track the current contents
    // of the files we care about.
    didOpen(uri: Uri){
        const fileName = path.basename(uri.fsPath);
        if (fileName === this.lakeFileName){
            void this.handleLakeFileChanged(uri, false);
        }
        else if (fileName === 'lean-toolchain'){
            void this.handleFileChanged(uri, false);
        }
        else if (fileName === 'leanpkg.toml'){
            void  this.handleFileChanged(uri, false);
        }
    }

    private async handleLakeFileChanged(uri : Uri, raiseEvent : boolean)  {
        // Note: just opening the file fires this event sometimes which is annoying, so
        // we compare the contents just to be sure and normalize whitespace so that
        // just adding a new line doesn't trigger the prompt.
        const [workspaceFolder, packageUri, packageFileUri] = await findLeanPackageRoot(uri);
        if (packageUri) {
            const fileUri = await this.findLakeFile(packageUri);
            if (fileUri) {
                const contents = await this.readWhitespaceNormalized(fileUri);
                let existing : string | undefined;
                const key = packageUri.toString();
                if (this.normalizedLakeFileContents.get(key)){
                    existing = this.normalizedLakeFileContents.get(key);
                }
                if (contents !== existing) {
                    this.normalizedLakeFileContents.set(key, contents);
                    if (raiseEvent) {
                        // raise an event so the extension triggers handleLakeFileChanged.
                        this.lakeFileChangedEmitter.fire(packageUri);
                    }
                }
            }
        }
    }

    private async handleFileChanged(uri: Uri, raiseEvent : boolean) {
        // note: apply the same rules here with findLeanPkgVersionInfo no matter
        // if a file is added or removed so we always match the elan behavior.
        const [packageUri, version] = await findLeanPackageVersionInfo(uri);
        if (packageUri && version) {
            let existing : string | undefined;
            const key = packageUri.toString();
            if (this.currentVersion.has(key)){
                existing = this.currentVersion.get(key);
            }
            if (existing !== version){
                this.currentVersion.set(key, version);
                if (raiseEvent) {
                    // raise an event so the extension triggers handleVersionChanged.
                    this.versionChangedEmitter.fire(packageUri);
                }
            }
        }
    }

    private async findLakeFile(packageUri: Uri) : Promise<Uri | null> {
        const fullPath = Uri.joinPath(packageUri, this.lakeFileName);
        const url = fullPath.fsPath;
        if(await fileExists(url)) {
            return fullPath;
        }
        return null;
    }

    // Return file contents with whitespace normalized.
    private async readWhitespaceNormalized(fileUri: Uri) : Promise<string> {
        try{
            const contents = (await workspace.fs.readFile(fileUri)).toString();
            // ignore whitespace changes by normalizing whitespace.
            const re = /[ \t\r\n]+/g
            const result = contents.replace(re, ' ');
            return result.trim();
        }
        catch(ex) {
            // In case there is an error in the read
            return '';
        }
    }

}
