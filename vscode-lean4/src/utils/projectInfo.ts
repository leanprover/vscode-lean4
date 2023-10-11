import * as fs from 'fs';
import { URL } from 'url';
import { FileType, Uri, workspace, WorkspaceFolder } from 'vscode';
import { fileExists } from './fsHelper';
import { logger } from './logger'
import path = require('path');

// Detect lean4 root directory (works for both lean4 repo and nightly distribution)

export async function isCoreLean4Directory(path: Uri): Promise<boolean> {
    if (path.scheme !== 'file') {
        return false
    }

    const licensePath = Uri.joinPath(path, 'LICENSE').fsPath
    const licensesPath = Uri.joinPath(path, 'LICENSES').fsPath
    const srcPath = Uri.joinPath(path, 'src').fsPath
    return await fileExists(licensePath)
        && await fileExists(licensesPath)
        && await fileExists(srcPath)
}

// Find the root of a Lean project and return an optional WorkspaceFolder for it,
// the Uri for the package root and the Uri for the 'leanpkg.toml' or 'lean-toolchain' file found there.
export async function findLeanPackageRoot(uri: Uri) : Promise<[WorkspaceFolder | undefined, Uri | null, Uri | null]> {
    if (!uri || uri.scheme !== 'file') return [undefined, null, null];

    const toolchainFileName = 'lean-toolchain';
    const tomlFileName = 'leanpkg.toml';

    let path = uri;
    let wsFolder = workspace.getWorkspaceFolder(uri);
    if (!wsFolder && workspace.workspaceFolders) {
        workspace.workspaceFolders.forEach((f) => {
            if (f.uri?.scheme === 'file' && f.uri.fsPath && uri.fsPath.startsWith(f.uri.fsPath)) {
                wsFolder = f;
            }
        });
    }
    let searchUpwards = false;
    if (wsFolder){
        // jump to the real workspace folder if we have a Workspace for this file.
        path = wsFolder.uri;
    } else {
        // then start searching from the directory containing this document.
        // The given uri may already be a folder Uri in some cases.
        if (fs.lstatSync(path.fsPath).isFile()) {
            path = Uri.joinPath(uri, '..');
        }
        searchUpwards = true;
    }

    const startFolder = path;
    // search parent folders for a leanpkg.toml file, or a Lake lean-toolchain file.
    while (true) {
        // give preference to 'lean-toolchain' files if any.
        const leanToolchain = Uri.joinPath(path, toolchainFileName);
        if (await fileExists(leanToolchain.fsPath)) {
            return [wsFolder, path, leanToolchain];
        } else {
            const leanPkg = Uri.joinPath(path, tomlFileName);
            if (await fileExists(leanPkg.fsPath)) {
                return [wsFolder, path, leanPkg];
            } else if (await isCoreLean4Directory(path)) {
                return [wsFolder, path, null];
            } else if (searchUpwards) {
                const parent = Uri.joinPath(path, '..');
                if (parent === path) {
                    // no project file found.
                    break;
                }
                path = parent;
            } else {
                // don't search above a WorkspaceFolder barrier.
                break;
            }
        }
    }

    return [wsFolder, startFolder, null];
}

// Find the lean project root for the given document and return the
// Uri for the project root and the "version" information contained
// in any 'lean-toolchain' or 'leanpkg.toml' file found there.
export async function findLeanPackageVersionInfo(uri: Uri) : Promise<[Uri | null, string | null]> {

    const [_, packageUri, packageFileUri] = await findLeanPackageRoot(uri);
    if (!packageUri) return [null, null];

    let version : string | null = null;
    if (packageFileUri) {
        try {
            version = await readLeanVersionFile(packageFileUri);
        } catch (err) {
            logger.log(`findLeanPackageVersionInfo caught exception ${err}`);
        }
    }

    return [packageUri, version];
}

// Find the 'leanpkg.toml' or 'lean-toolchain' in the given package root and
// extract the Lean version info from it.
export async function readLeanVersion(packageUri: Uri) : Promise<string | null> {
    const toolchainFileName = 'lean-toolchain';
    const tomlFileName = 'leanpkg.toml';
    if (packageUri.scheme === 'file') {
        const leanToolchain = Uri.joinPath(packageUri, toolchainFileName);
        if (fs.existsSync(new URL(leanToolchain.toString()))) {
            return await readLeanVersionFile(leanToolchain);
        } else {
            const leanPkg = Uri.joinPath(packageUri, tomlFileName);
            if (fs.existsSync(new URL(leanPkg.toString()))) {
                return await readLeanVersionFile(leanPkg);
            }
        }
    }
    return null;
}

async function readLeanVersionFile(packageFileUri : Uri) : Promise<string> {
    const url = new URL(packageFileUri.toString());
    const tomlFileName = 'leanpkg.toml';
    if (packageFileUri.scheme !== 'file'){
        return '';
    }

    if (packageFileUri.path.endsWith(tomlFileName))
    {
        const data = (await fs.promises.readFile(url, {encoding: 'utf-8'})).trim();
        if (data) {
            const match = /lean_version\s*=\s*"([^"]*)"/.exec(data);
            if (match) return match[1].trim();
        }

    } else {
        // must be a lean-toolchain file, these are much simpler they only contain a version.
        return (await fs.promises.readFile(url, {encoding: 'utf-8'})).trim();

    }
    return '';

}

export async function isValidLeanProject(projectFolder: Uri): Promise<boolean> {
    try {
        const leanToolchainPath = Uri.joinPath(projectFolder, 'lean-toolchain').fsPath

        const isLeanProject: boolean = await fileExists(leanToolchainPath)
        const isLeanItself: boolean = await isCoreLean4Directory(projectFolder)
        return isLeanProject || isLeanItself
    } catch {
        return false
    }
}

export async function checkParentFoldersForLeanProject(folder: Uri): Promise<Uri | undefined> {
    let childFolder: Uri
    do {
        childFolder = folder
        folder = Uri.file(path.dirname(folder.fsPath))
        if (await isValidLeanProject(folder)) {
            return folder
        }
    } while (childFolder.fsPath !== folder.fsPath)
    return undefined
}
