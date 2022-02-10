import { EventEmitter, Disposable, Uri, workspace, window, WorkspaceFolder } from 'vscode';
import { LocalStorageService} from './localStorage'
import { findLeanPackageVersionInfo } from './projectInfo';

export class LeanpkgService implements Disposable {
    private subscriptions: Disposable[] = [];
    private defaultToolchain : string;
    private localStorage : LocalStorageService;
    private currentVersion : string = null;

    // This event is raised when the version in the package root changes.
    // The event provides the lean package root Uri.
    private versionChangedEmitter = new EventEmitter<Uri>();
    versionChanged = this.versionChangedEmitter.event

    constructor(localStorage : LocalStorageService, defaultToolchain : string) {
        this.localStorage = localStorage;
        this.defaultToolchain = defaultToolchain;

        // track changes in the version of lean specified in the lean-toolchain file
        // or the leanpkg.toml.  While this is looking for all files with these names
        // it ignores files that are not in the package root.
        ['**/lean-toolchain', '**/leanpkg.toml'].forEach(pattern => {
            const watcher = workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange((u) => this.handleFileChanged(u));
            watcher.onDidCreate((u) => this.handleFileChanged(u));
            watcher.onDidDelete((u) => this.handleFileChanged(u));
            this.subscriptions.push(watcher);
        });
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
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
        const [packageUri, version] = await findLeanPackageVersionInfo(uri);
        if (packageUri && version && version !== current) {
            // raise an event so the extension triggers handleVersionChanged.
            this.versionChangedEmitter.fire(packageUri);
        }
    }
}
