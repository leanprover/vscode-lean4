import { Uri, workspace } from 'vscode'
import { isFileInFolder, relativeFilePathInFolder } from './fsHelper'

function unsupportedSchemeError(uri: Uri): Error {
    return new Error(`Got URI with unsupported scheme '${uri.scheme}': '${uri}'`)
}

export class FileUri {
    scheme: 'file'
    fsPath: string

    constructor(fsPath: string) {
        this.scheme = 'file'
        this.fsPath = fsPath
    }

    static fromUri(uri: Uri): FileUri | undefined {
        if (uri.scheme !== 'file') {
            return undefined
        }
        return new FileUri(uri.fsPath)
    }

    static fromUriOrError(uri: Uri): FileUri {
        const fileUri = FileUri.fromUri(uri)
        if (fileUri === undefined) {
            throw unsupportedSchemeError(uri)
        }
        return fileUri
    }

    asUri(): Uri {
        return Uri.file(this.fsPath)
    }

    equals(other: FileUri): boolean {
        return this.fsPath === other.fsPath
    }

    equalsUri(other: Uri): boolean {
        const otherFileUri = FileUri.fromUri(other)
        if (otherFileUri === undefined) {
            return false
        }
        return this.equals(otherFileUri)
    }

    toString(): string {
        return this.asUri().toString()
    }

    join(...pathSegments: string[]): FileUri {
        return FileUri.fromUriOrError(Uri.joinPath(this.asUri(), ...pathSegments))
    }

    isInFolder(folderUri: FileUri): boolean {
        return isFileInFolder(this.fsPath, folderUri.fsPath)
    }

    relativeTo(folderUri: FileUri): FileUri | undefined {
        const relativePath: string | undefined = relativeFilePathInFolder(this.fsPath, folderUri.fsPath)
        if (relativePath === undefined) {
            return undefined
        }
        return new FileUri(relativePath)
    }
}

export function isInWorkspaceFolder(uri: FileUri): boolean {
    return workspace.getWorkspaceFolder(uri.asUri()) !== undefined
}

export function isWorkspaceFolder(uri: FileUri): boolean {
    if (workspace.workspaceFolders === undefined) {
        return false
    }
    return workspace.workspaceFolders.some(folder => uri.equalsUri(folder.uri))
}

export class UntitledUri {
    scheme: 'untitled'
    name: string

    constructor(name?: string | undefined) {
        this.scheme = 'untitled'
        this.name = name ?? ''
    }

    static fromUri(uri: Uri): UntitledUri | undefined {
        if (uri.scheme !== 'untitled') {
            return undefined
        }
        return new UntitledUri(uri.path)
    }

    static fromUriOrError(uri: Uri): UntitledUri {
        const untitledUri = UntitledUri.fromUri(uri)
        if (untitledUri === undefined) {
            throw unsupportedSchemeError(uri)
        }
        return untitledUri
    }

    asUri(): Uri {
        return Uri.from({ scheme: 'untitled', path: this.name })
    }

    equals(other: UntitledUri): boolean {
        return this.name === other.name
    }

    equalsUri(other: Uri): boolean {
        const otherFileUri = UntitledUri.fromUri(other)
        if (otherFileUri === undefined) {
            return false
        }
        return this.equals(otherFileUri)
    }

    toString(): string {
        return this.asUri().toString()
    }
}

export class LiveShareUri {
    scheme: 'vsls'
    syntheticPath: string

    constructor(syntheticPath: string) {
        this.scheme = 'vsls'
        this.syntheticPath = syntheticPath
    }

    static fromUri(uri: Uri): LiveShareUri | undefined {
        if (uri.scheme !== 'vsls') {
            return undefined
        }
        return new LiveShareUri(uri.path)
    }

    static fromUriOrError(uri: Uri): LiveShareUri {
        const liveShareUri = LiveShareUri.fromUri(uri)
        if (liveShareUri === undefined) {
            throw unsupportedSchemeError(uri)
        }
        return liveShareUri
    }

    asUri(): Uri {
        return Uri.from({
            scheme: this.scheme,
            path: this.syntheticPath,
        })
    }

    equals(other: LiveShareUri): boolean {
        return this.syntheticPath === other.syntheticPath
    }

    equalsUri(other: Uri): boolean {
        const otherLiveShareUri = LiveShareUri.fromUri(other)
        if (otherLiveShareUri === undefined) {
            return false
        }
        return this.equals(otherLiveShareUri)
    }

    toString(): string {
        return this.asUri().toString()
    }
}

/** Uris in which a language server can be launched. */
export type ServerUri = FileUri | UntitledUri

export function isServerUri(uri: Uri): boolean {
    return uri.scheme === 'untitled' || uri.scheme === 'file'
}

export function toServerUri(uri: Uri): ServerUri | undefined {
    if (uri.scheme === 'untitled') {
        return new UntitledUri(uri.path)
    }
    if (uri.scheme === 'file') {
        return new FileUri(uri.fsPath)
    }
    return undefined
}

export function toServerUriOrError(uri: Uri): ServerUri {
    const result: ServerUri | undefined = toServerUri(uri)
    if (result === undefined) {
        throw unsupportedSchemeError(uri)
    }
    return result
}

export function parseServerUri(uriString: string): ServerUri | undefined {
    return toServerUri(Uri.parse(uriString))
}

export function parseServerUriOrError(uriString: string): ServerUri {
    return toServerUriOrError(Uri.parse(uriString))
}

export function serverUriEquals(a: ServerUri, b: ServerUri): boolean {
    if (a.scheme === 'untitled' && b.scheme === 'untitled') {
        return a.equals(b)
    }
    if (a.scheme === 'file' && b.scheme === 'file') {
        return a.equals(b)
    }
    return false
}

export function serverUriToCwdUri(uri: ServerUri): FileUri | undefined {
    if (uri.scheme !== 'file') {
        return undefined
    }
    return uri
}

/** Uris supported by this extension. */
export type ExtUri = FileUri | UntitledUri | LiveShareUri

export function isExtUri(uri: Uri): boolean {
    return uri.scheme === 'untitled' || uri.scheme === 'file' || uri.scheme === 'vsls'
}

export function toExtUri(uri: Uri): ExtUri | undefined {
    if (uri.scheme === 'untitled') {
        return new UntitledUri(uri.path)
    }
    if (uri.scheme === 'file') {
        return new FileUri(uri.fsPath)
    }
    if (uri.scheme === 'vsls') {
        return new LiveShareUri(uri.path)
    }
    return undefined
}

export function toExtUriOrError(uri: Uri): ExtUri {
    const result: ExtUri | undefined = toExtUri(uri)
    if (result === undefined) {
        throw unsupportedSchemeError(uri)
    }
    return result
}

export function parseExtUri(uriString: string): ExtUri | undefined {
    return toExtUri(Uri.parse(uriString))
}

export function parseExtUriOrError(uriString: string): ExtUri {
    return toExtUriOrError(Uri.parse(uriString))
}

export function extUriEquals(a: ExtUri, b: ExtUri): boolean {
    if (a.scheme === 'untitled' && b.scheme === 'untitled') {
        return a.equals(b)
    }
    if (a.scheme === 'file' && b.scheme === 'file') {
        return a.equals(b)
    }
    if (a.scheme === 'vsls' && b.scheme === 'vsls') {
        return a.equals(b)
    }
    return false
}

export function extUriToCwdUri(uri: ExtUri): FileUri | undefined {
    if (uri.scheme !== 'file') {
        return undefined
    }
    return uri
}
