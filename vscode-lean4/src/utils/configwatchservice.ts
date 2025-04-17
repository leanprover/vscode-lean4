import * as path from 'path'
import { Disposable, EventEmitter, Uri, window, workspace } from 'vscode'
import { FileUri } from './exturi'
import { findLeanProjectInfo, findLeanProjectRootInfo } from './projectInfo'

// This service monitors the Lean package root folders for changes to any
// lean-toolchail, lakefile.lean or lakefile.toml files found there.
export class LeanConfigWatchService implements Disposable {
    private subscriptions: Disposable[] = []
    private lakeFileLeanName: string = 'lakefile.lean'
    private lakeFileTomlName: string = 'lakefile.toml'
    // We track the current version info for each workspace open in VS code.
    private currentVersion: Map<string, string> = new Map()
    private normalizedLakeFileContents: Map<string, string> = new Map()

    // This event is raised when the version in the package root changes.
    // The event provides the lean package root Uri.
    private versionChangedEmitter = new EventEmitter<FileUri>()
    versionChanged = this.versionChangedEmitter.event

    // This event is raised if the 'lakefile.lean' file contents is changed.
    // The event provides the lean package root Uri.
    private lakeFileChangedEmitter = new EventEmitter<FileUri>()
    lakeFileChanged = this.lakeFileChangedEmitter.event

    constructor() {
        const watcher1 = workspace.createFileSystemWatcher('**/lean-toolchain')
        watcher1.onDidChange(u => this.handleFileChanged(u, true))
        watcher1.onDidCreate(u => this.handleFileChanged(u, true))
        watcher1.onDidDelete(u => this.handleFileChanged(u, true))
        this.subscriptions.push(watcher1)

        const watcher2 = workspace.createFileSystemWatcher(`**/${this.lakeFileLeanName}`)
        watcher2.onDidChange(u => this.handleLakeFileChanged(u, true))
        watcher2.onDidCreate(u => this.handleLakeFileChanged(u, true))
        watcher2.onDidDelete(u => this.handleLakeFileChanged(u, true))
        this.subscriptions.push(watcher2)

        const watcher3 = workspace.createFileSystemWatcher(`**/${this.lakeFileTomlName}`)
        watcher3.onDidChange(u => this.handleLakeFileChanged(u, true))
        watcher3.onDidCreate(u => this.handleLakeFileChanged(u, true))
        watcher3.onDidDelete(u => this.handleLakeFileChanged(u, true))
        this.subscriptions.push(watcher3)

        window.visibleTextEditors.forEach(e => this.didOpen(e.document.uri))
        this.subscriptions.push(
            window.onDidChangeVisibleTextEditors(es => es.forEach(e => this.didOpen(e.document.uri))),
        )
        workspace.onDidOpenTextDocument(document => this.didOpen(document.uri))
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }

    // Must be called when every file is opened so it can track the current contents
    // of the files we care about.
    private didOpen(uri: Uri) {
        if (uri.scheme !== 'file') {
            return
        }
        const fileName = path.basename(uri.fsPath)
        if (fileName === this.lakeFileLeanName || fileName === this.lakeFileTomlName) {
            void this.handleLakeFileChanged(uri, false)
        } else if (fileName === 'lean-toolchain') {
            void this.handleFileChanged(uri, false)
        }
    }

    private async handleLakeFileChanged(uri: Uri, raiseEvent: boolean) {
        const fileUri = FileUri.fromUri(uri)
        if (fileUri === undefined) {
            return
        }

        // Note: just opening the file fires this event sometimes which is annoying, so
        // we compare the contents just to be sure and normalize whitespace so that
        // just adding a new line doesn't trigger the prompt.
        const info = await findLeanProjectRootInfo(fileUri)
        if (
            info.kind === 'FileNotFound' ||
            info.kind === 'LakefileWithoutToolchain' ||
            info.projectRootUri.scheme === 'untitled'
        ) {
            return
        }

        const contents = await this.readWhitespaceNormalized(fileUri)
        let existing: string | undefined
        const key = fileUri.toString()
        if (this.normalizedLakeFileContents.get(key)) {
            existing = this.normalizedLakeFileContents.get(key)
        }
        if (contents === existing) {
            return
        }

        this.normalizedLakeFileContents.set(key, contents)
        if (raiseEvent) {
            // raise an event so the extension triggers handleLakeFileChanged.
            this.lakeFileChangedEmitter.fire(info.projectRootUri)
        }
    }

    private async handleFileChanged(uri: Uri, raiseEvent: boolean) {
        const fileUri = FileUri.fromUri(uri)
        if (fileUri === undefined) {
            return
        }

        // note: apply the same rules here with findLeanPackageVersionInfo no matter
        // if a file is added or removed so we always match the elan behavior.
        const projectInfo = await findLeanProjectInfo(fileUri)
        if (
            projectInfo.kind === 'FileNotFound' ||
            projectInfo.kind === 'LakefileWithoutToolchain' ||
            projectInfo.projectRootUri.scheme === 'untitled' ||
            projectInfo.toolchainInfo === undefined ||
            projectInfo.toolchainInfo.toolchain === undefined
        ) {
            return
        }
        const projectUri = projectInfo.projectRootUri
        const version = projectInfo.toolchainInfo.toolchain

        let existing: string | undefined
        const key = projectUri.toString()
        if (this.currentVersion.has(key)) {
            existing = this.currentVersion.get(key)
        }
        if (existing === version) {
            return
        }

        this.currentVersion.set(key, version)
        if (raiseEvent) {
            // raise an event so the extension triggers handleVersionChanged.
            this.versionChangedEmitter.fire(projectUri)
        }
    }

    // Return file contents with whitespace normalized.
    private async readWhitespaceNormalized(fileUri: FileUri): Promise<string> {
        try {
            const contents = (await workspace.fs.readFile(fileUri.asUri())).toString()
            // ignore whitespace changes by normalizing whitespace.
            const re = /[ \t\r\n]+/g
            const result = contents.replace(re, ' ')
            return result.trim()
        } catch (ex) {
            // In case there is an error in the read
            return ''
        }
    }
}
