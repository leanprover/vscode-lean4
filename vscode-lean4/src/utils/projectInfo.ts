import * as fs from 'fs'
import path from 'path'
import { ExtUri, FileUri, getWorkspaceFolderUri, UntitledUri } from './exturi'
import { dirExists, fileExists } from './fsHelper'

// Detect lean4 root directory (works for both lean4 repo and nightly distribution)

export async function isCoreLean4Directory(path: FileUri): Promise<boolean> {
    const licensePath = path.join('LICENSE').fsPath
    const licensesPath = path.join('LICENSES').fsPath
    const srcPath = path.join('src').fsPath

    const isCoreLean4RootDirectory =
        (await fileExists(licensePath)) && (await fileExists(licensesPath)) && (await dirExists(srcPath))
    if (isCoreLean4RootDirectory) {
        return true
    }

    const initPath = path.join('Init.lean').fsPath
    const leanPath = path.join('Lean.lean').fsPath
    const kernelPath = path.join('kernel').fsPath
    const runtimePath = path.join('runtime').fsPath

    const isCoreLean4SrcDirectory =
        (await fileExists(initPath)) &&
        (await fileExists(leanPath)) &&
        (await dirExists(kernelPath)) &&
        (await dirExists(runtimePath))
    return isCoreLean4SrcDirectory
}

type ProjectRootInfo =
    | { kind: 'Success'; projectRootUri: ExtUri; toolchainUri: FileUri | undefined }
    | { kind: 'FileNotFound' }
    | { kind: 'LakefileWithoutToolchain'; projectRootUri: FileUri; lakefileUri: FileUri }
type ToolchainInfo = { uri: FileUri; toolchain: string | undefined }
type ProjectInfo =
    | { kind: 'Success'; projectRootUri: ExtUri; toolchainInfo: ToolchainInfo | undefined }
    | { kind: 'FileNotFound' }
    | { kind: 'LakefileWithoutToolchain'; projectRootUri: FileUri; lakefileUri: FileUri }

export function leanToolchainUri(projectUri: FileUri) {
    return projectUri.join('lean-toolchain')
}

export function lakefileTomlUri(projectUri: FileUri) {
    return projectUri.join('lakefile.toml')
}

export function lakefileLeanUri(projectUri: FileUri) {
    return projectUri.join('lakefile.lean')
}

function parentDirOf(uri: FileUri, subpath: string): FileUri | undefined {
    const numComponents = subpath.split(path.sep).length
    let p = uri.normalize().fsPath
    const i = p.indexOf(subpath)
    if (i === -1) {
        return undefined
    }
    p = p.slice(0, i + subpath.length)
    // Ensures that there is no trailing `/`.
    for (let n = 0; n < numComponents; n++) {
        p = path.dirname(p)
    }
    return new FileUri(p)
}

function routePackagesDir(uri: FileUri): FileUri {
    // `lean-toolchain` files in `.lake/packages` are ignored because
    // the appropriate project scope for dependencies of a project is the root directory of the project.
    // Technically, Lake allows configuring the location of the packages directory, so the extension may not be able to figure out
    // the correct project scope for a dependency when this setting is set.
    // In the future, Lake may maintain a back-link from the directory of dependencies back to the project root,
    // but for now, this heuristic must suffice.
    return parentDirOf(uri, path.join('.lake', 'packages')) ?? uri
}

// Find the root of a Lean project and the Uri for the 'lean-toolchain' file found there.
export async function findLeanProjectRootInfo(uri: ExtUri): Promise<ProjectRootInfo> {
    if (uri.scheme === 'untitled') {
        return { kind: 'Success', projectRootUri: new UntitledUri(), toolchainUri: undefined }
    }

    let uriDir: FileUri
    try {
        if ((await fs.promises.stat(uri.fsPath)).isFile()) {
            uriDir = uri.join('..')
        } else {
            uriDir = uri
        }
    } catch (e) {
        return { kind: 'FileNotFound' }
    }

    let currentDir = routePackagesDir(uriDir)

    while (true) {
        const leanToolchain = leanToolchainUri(currentDir)
        const lakefileLean = lakefileLeanUri(currentDir)
        const lakefileToml = lakefileTomlUri(currentDir)
        if (await fileExists(leanToolchain.fsPath)) {
            return { kind: 'Success', projectRootUri: currentDir, toolchainUri: leanToolchain }
        }
        if (await isCoreLean4Directory(currentDir)) {
            return { kind: 'Success', projectRootUri: currentDir, toolchainUri: undefined }
        }
        if (await fileExists(lakefileLean.fsPath)) {
            return { kind: 'LakefileWithoutToolchain', projectRootUri: currentDir, lakefileUri: lakefileLean }
        }
        if (await fileExists(lakefileToml.fsPath)) {
            return { kind: 'LakefileWithoutToolchain', projectRootUri: currentDir, lakefileUri: lakefileToml }
        }

        const parentDir = currentDir.join('..')
        if (parentDir.equals(currentDir)) {
            break
        }
        currentDir = parentDir
    }

    // No `lean-toolchain` or core directory found.
    // If the file is in a workspace folder, we use the workspace folder,
    // and otherwise we use the immediate directory that the file is contained in.
    // In nested workspace folders, VS Code yields the innermost one.
    const workspaceDir = getWorkspaceFolderUri(uri)
    if (workspaceDir !== undefined) {
        return { kind: 'Success', projectRootUri: workspaceDir, toolchainUri: undefined }
    }

    return { kind: 'Success', projectRootUri: uriDir, toolchainUri: undefined }
}

export async function findLeanProjectInfo(uri: FileUri): Promise<ProjectInfo> {
    const info = await findLeanProjectRootInfo(uri)
    switch (info.kind) {
        case 'Success':
            let toolchainInfo: ToolchainInfo | undefined
            if (info.toolchainUri !== undefined) {
                toolchainInfo = { uri: info.toolchainUri, toolchain: await readLeanToolchainFile(info.toolchainUri) }
            }
            return { kind: 'Success', projectRootUri: info.projectRootUri, toolchainInfo }
        case 'FileNotFound':
            return info
        case 'LakefileWithoutToolchain':
            return info
    }
}

async function readLeanToolchainFile(toolchainFileUri: FileUri): Promise<string | undefined> {
    try {
        return (await fs.promises.readFile(toolchainFileUri.fsPath, { encoding: 'utf-8' })).trim()
    } catch {
        return undefined
    }
}

export async function isValidLeanProject(projectFolder: FileUri): Promise<boolean> {
    try {
        const leanToolchainPath = leanToolchainUri(projectFolder).fsPath

        const isLeanProject: boolean = await fileExists(leanToolchainPath)
        const isLeanItself: boolean = await isCoreLean4Directory(projectFolder)
        return isLeanProject || isLeanItself
    } catch {
        return false
    }
}

export async function checkParentFoldersForLeanProject(folder: FileUri): Promise<FileUri | undefined> {
    let childFolder: FileUri
    do {
        childFolder = folder
        folder = new FileUri(path.dirname(folder.fsPath))
        if (await isValidLeanProject(folder)) {
            return folder
        }
    } while (!childFolder.equals(folder))
    return undefined
}

export async function willUseLakeServer(folder: ExtUri): Promise<boolean> {
    if (folder.scheme !== 'file') {
        return false
    }

    const lakefileLean = lakefileLeanUri(folder)
    const lakefileToml = lakefileTomlUri(folder)
    return (await fileExists(lakefileLean.fsPath)) || (await fileExists(lakefileToml.fsPath))
}
