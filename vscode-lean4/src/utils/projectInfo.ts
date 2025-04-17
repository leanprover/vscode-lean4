import * as fs from 'fs'
import path from 'path'
import { ExtUri, FileUri, isWorkspaceFolder, UntitledUri } from './exturi'
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

// Find the root of a Lean project and the Uri for the 'lean-toolchain' file found there.
export async function findLeanProjectRootInfo(uri: ExtUri): Promise<ProjectRootInfo> {
    if (uri.scheme === 'untitled') {
        return { kind: 'Success', projectRootUri: new UntitledUri(), toolchainUri: undefined }
    }
    let path = uri
    try {
        if ((await fs.promises.stat(path.fsPath)).isFile()) {
            path = uri.join('..')
        }
    } catch (e) {
        return { kind: 'FileNotFound' }
    }

    let bestFolder = path
    let bestLeanToolchain: FileUri | undefined
    while (true) {
        const leanToolchain = path.join('lean-toolchain')
        const lakefileLean = path.join('lakefile.lean')
        const lakefileToml = path.join('lakefile.toml')
        if (await fileExists(leanToolchain.fsPath)) {
            bestFolder = path
            bestLeanToolchain = leanToolchain
        } else if (await isCoreLean4Directory(path)) {
            bestFolder = path
            bestLeanToolchain = undefined
            // Stop searching in case users accidentally created a lean-toolchain file above the core directory
            break
        } else if (await fileExists(lakefileLean.fsPath)) {
            return { kind: 'LakefileWithoutToolchain', projectRootUri: path, lakefileUri: lakefileLean }
        } else if (await fileExists(lakefileToml.fsPath)) {
            return { kind: 'LakefileWithoutToolchain', projectRootUri: path, lakefileUri: lakefileToml }
        }
        if (isWorkspaceFolder(path)) {
            if (bestLeanToolchain === undefined) {
                // If we haven't found a toolchain yet, prefer the workspace folder as the project scope for the file,
                // but keep looking in case there is a lean-toolchain above the workspace folder
                // (New users sometimes accidentally open sub-folders of projects)
                bestFolder = path
            } else {
                // Stop looking above the barrier if we have a toolchain. This is necessary for the nested lean-toolchain setup of core.
                break
            }
        }
        const parent = path.join('..')
        if (parent.equals(path)) {
            // no project file found.
            break
        }
        path = parent
    }

    return { kind: 'Success', projectRootUri: bestFolder, toolchainUri: bestLeanToolchain }
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
        const leanToolchainPath = projectFolder.join('lean-toolchain').fsPath

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

    const lakefileLean = folder.join('lakefile.lean')
    const lakefileToml = folder.join('lakefile.toml')
    return (await fileExists(lakefileLean.fsPath)) || (await fileExists(lakefileToml.fsPath))
}
