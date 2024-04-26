import { Uri, workspace } from 'vscode'
import { isFileInFolder } from './fsHelper'

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
}

export function getWorkspaceFolderUri(uri: FileUri): FileUri | undefined {
    const folder = workspace.getWorkspaceFolder(uri.asUri())
    if (folder === undefined) {
        return undefined
    }
    const folderUri = FileUri.fromUri(folder.uri)
    if (folderUri === undefined) {
        return undefined
    }
    return folderUri
}

export class UntitledUri {
    scheme: 'untitled'

    constructor() {
        this.scheme = 'untitled'
    }

    asUri(): Uri {
        return Uri.from({ scheme: 'untitled' })
    }

    equalsUri(other: Uri): boolean {
        return other.scheme === 'untitled'
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
        return new UntitledUri()
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
