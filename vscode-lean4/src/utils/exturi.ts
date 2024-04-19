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

    static fromUriOrError(uri: Uri): FileUri {
        if (uri.scheme !== 'file') {
            throw unsupportedSchemeError(uri)
        }
        return new FileUri(uri.fsPath)
    }

    asUri(): Uri {
        return Uri.file(this.fsPath)
    }

    equals(other: FileUri): boolean {
        return this.fsPath === other.fsPath
    }

    equalsUri(other: Uri): boolean {
        if (other.scheme !== 'file') {
            return false
        }
        return this.equals(new FileUri(other.fsPath))
    }

    toString(): string {
        return this.asUri().toString()
    }

    join(...pathSegments: string[]): FileUri {
        return new FileUri(Uri.joinPath(this.asUri(), ...pathSegments).fsPath)
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
    return FileUri.fromUriOrError(folder.uri)
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

export function extUriOrError(uri: Uri): ExtUri {
    if (uri.scheme === 'untitled') {
        return new UntitledUri()
    }
    if (uri.scheme === 'file') {
        return new FileUri(uri.fsPath)
    }
    throw new Error(`Got URI with unsupported scheme '${uri.scheme}': '${uri}'`)
}

export function parseExtUri(uriString: string): ExtUri {
    return extUriOrError(Uri.parse(uriString))
}
