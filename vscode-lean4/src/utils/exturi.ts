import path from 'path'
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

    baseName(): string {
        return path.basename(this.fsPath)
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
    path: string

    constructor(path?: string | undefined) {
        this.scheme = 'untitled'
        this.path = path ?? ''
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
        return Uri.from({ scheme: 'untitled', path: this.path })
    }

    equals(other: UntitledUri): boolean {
        return this.path === other.path
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

/** Uris supported by this extension. */
export type ExtUri = FileUri | UntitledUri

export function isExtUri(uri: Uri): boolean {
    return uri.scheme === 'untitled' || uri.scheme === 'file'
}

export function toExtUri(uri: Uri): ExtUri | undefined {
    if (uri.scheme === 'untitled') {
        return new UntitledUri(uri.path)
    }
    if (uri.scheme === 'file') {
        return new FileUri(uri.fsPath)
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
    return false
}

export function extUriToCwdUri(uri: ExtUri): FileUri | undefined {
    if (uri.scheme === 'untitled') {
        return undefined
    }
    return uri
}
