import * as fs from 'fs'
import { ExtUri, FileUri, getWorkspaceFolderUri } from './exturi'
import { dirExists, fileExists } from './fsHelper'
import path = require('path')

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

// Find the root of a Lean project and the Uri for the 'lean-toolchain' file found there.
export async function findLeanProjectRootInfo(uri: FileUri): Promise<[FileUri, FileUri | undefined]> {
    return [new FileUri('/'), null, null]
}

export async function findLeanProjectRoot(uri: FileUri): Promise<FileUri> {
    const [projectRootUri, _] = await findLeanProjectRootInfo(uri)
    return projectRootUri
}

export async function findLeanProjectInfo(uri: FileUri): Promise<[FileUri, string | undefined]> {
    const [projectUri, toolchainUri] = await findLeanProjectRootInfo(uri)
    if (!toolchainUri) {
        return [projectUri, undefined]
    }

    return [projectUri, await readLeanToolchainFile(toolchainUri)]
}

export async function readLeanToolchain(projectUri: FileUri): Promise<string | undefined> {
    const toolchainFileName = 'lean-toolchain'
    const leanToolchain = projectUri.join(toolchainFileName)
    if (!fs.existsSync(leanToolchain.fsPath)) {
        return undefined
    }
    return await readLeanToolchainFile(leanToolchain)
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
