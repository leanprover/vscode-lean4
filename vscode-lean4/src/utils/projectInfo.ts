import * as fs from 'fs';
import { URL } from 'url';
import { Uri, workspace, WorkspaceFolder } from 'vscode';

// Find the root of a Lean project and return the Uri for the package root and the Uri
// for the 'leanpkg.toml' or 'lean-toolchain' file found there.
export function findLeanPackageRoot(uri: Uri) : [WorkspaceFolder, Uri,Uri] {
    if (!uri) return [null, null, null];

    const toolchainFileName = 'lean-toolchain';
    const tomlFileName = 'leanpkg.toml';
    if (uri.scheme == 'untitled'){
        // then return a Uri representing all untitled files.
        return [null, Uri.from({scheme: 'untitled'}), null];
    }
    let path = uri;
    let wsFolder = workspace.getWorkspaceFolder(uri);
    if (!wsFolder && workspace.workspaceFolders) {
        workspace.workspaceFolders.forEach((f) => {
            if (f.uri?.scheme == 'file' && f.uri.fsPath && uri.fsPath.startsWith(f.uri.fsPath)) {
                wsFolder = f;
            }
        });
    }
    let searchUpwards = false;
    if (wsFolder){
        // jump to the real workspace folder if we have a Workspace for this file.
        path = wsFolder.uri;
    } else if (path.scheme == 'file') {
        // then start searching from the directory containing this document.
        // The given uri may already be a folder Uri in some cases.
        if (fs.lstatSync(path.fsPath).isFile()) {
            path = Uri.joinPath(uri, '..');
        }
        searchUpwards = true;
    }
    if (path.scheme == 'file') {
        // search parent folders for a leanpkg.toml file, or a Lake lean-toolchain file.
        while (true) {
            // give preference to 'lean-toolchain' files if any.
            const leanToolchain = Uri.joinPath(path, toolchainFileName);
            if (fs.existsSync(leanToolchain.fsPath)) {
                return [wsFolder, path, leanToolchain];
            }
            else {
                const leanPkg = Uri.joinPath(path, tomlFileName);
                if (fs.existsSync(leanPkg.fsPath)) {
                    return [wsFolder, path, leanPkg];
                }
                else if (searchUpwards) {
                    const parent = Uri.joinPath(path, '..');
                    if (parent === path) {
                        // no project file found.
                        break;
                    }
                    path = parent;
                }
                else {
                    // don't search above a WorkspaceFolder barrier.
                    break;
                }
            }
        }
    } else {
        // TODO: do we care about HTTP schemes?
        return [null, null, null];
    }
}

// Find the lean project root for the given document and return the
// Uri for the project root and the "version" information contained
// in any 'lean-toolchain' or 'leanpkg.toml' file found there.
export async function findLeanPackageVersionInfo(uri: Uri) : Promise<[Uri,string]> {

    const [_, packageUri, packageFileUri] =findLeanPackageRoot(uri);
    if (!packageUri || packageUri.scheme == 'untitled') return null;

    let version = null;
    if (packageFileUri) {
        try {
            version = await readLeanVersionFile(packageFileUri);
        } catch (err) {
            console.log(err);
        }
    }

    return [packageUri, version];
}

// Find the 'leanpkg.toml' or 'lean-toolchain' in the given package root and
// extract the Lean version info from it.
export async function readLeanVersion(packageUri: Uri){
    const toolchainFileName = 'lean-toolchain';
    const tomlFileName = 'leanpkg.toml';
    const leanToolchain = Uri.joinPath(packageUri, toolchainFileName);
    if (fs.existsSync(new URL(leanToolchain.toString()))) {
        return await readLeanVersionFile(leanToolchain);
    }
    else {
        const leanPkg = Uri.joinPath(packageUri, tomlFileName);
        if (fs.existsSync(new URL(leanPkg.toString()))) {
            return readLeanVersionFile(leanPkg);
        }
    }
    return null;
}

async function readLeanVersionFile(packageFileUri) : Promise<string> {
    const url = new URL(packageFileUri.toString());
    const tomlFileName = 'leanpkg.toml';
    if (packageFileUri.path.endsWith(tomlFileName))
    {
        return new Promise<string>((resolve, reject) => {
            if (fs.existsSync(url)) {
                fs.readFile(url, { encoding: 'utf-8' }, (err, data) =>{
                    if (err) {
                        reject(err);
                    } else {
                        let version = null;
                        const match = /lean_version\s*=\s*"([^"]*)"/.exec(data.toString());
                        if (match) resolve(match[1]);
                        reject(null);
                    }
                });
            } else {
                resolve(null);
            }
        });
    } else {
        // must be a lean-toolchain file, these are much simpler they only contain a version.
        return new Promise<string>((resolve, reject) => {
            if (fs.existsSync(url)) {
                fs.readFile(url, { encoding: 'utf-8' }, (err, data) =>{
                    if (err) {
                        reject(err);
                    } else if (data) {
                        resolve(data.trim());
                    } else {
                        reject(null);
                    }
                });
            } else {
                reject(null);
            }
        });
    }
}
