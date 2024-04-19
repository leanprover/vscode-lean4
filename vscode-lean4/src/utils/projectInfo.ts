import * as fs from 'fs'
import { fileExists } from './fsHelper'
import { logger } from './logger'
import path = require('path')
import { FileUri, getWorkspaceFolderUri } from './exturi'

// Detect lean4 root directory (works for both lean4 repo and nightly distribution)

export async function isCoreLean4Directory(path: FileUri): Promise<boolean> {
    const licensePath = path.join('LICENSE').fsPath
    const licensesPath = path.join('LICENSES').fsPath
    const srcPath = path.join('src').fsPath

    const isCoreLean4RootDirectory =
        (await fileExists(licensePath)) && (await fileExists(licensesPath)) && (await fileExists(srcPath))
    if (isCoreLean4RootDirectory) {
        return true
    }

    const initPath = path.join('Init').fsPath
    const leanPath = path.join('Lean').fsPath
    const kernelPath = path.join('kernel').fsPath
    const runtimePath = path.join('runtime').fsPath

    const isCoreLean4SrcDirectory =
        (await fileExists(initPath)) &&
        (await fileExists(leanPath)) &&
        (await fileExists(kernelPath)) &&
        (await fileExists(runtimePath))
    return isCoreLean4SrcDirectory
}

// Find the root of a Lean project and the Uri for the 'lean-toolchain' file found there.
export async function findLeanPackageRoot(uri: FileUri): Promise<[FileUri, FileUri | undefined]> {
    const toolchainFileName = 'lean-toolchain'

    let path = uri
    const containingWsFolderUri = getWorkspaceFolderUri(uri)

    // then start searching from the directory containing this document.
    // The given uri may already be a folder Uri in some cases.
    if (fs.lstatSync(path.fsPath).isFile()) {
        path = uri.join('..')
    }

    let bestFolder = path
    let bestLeanToolchain: FileUri | undefined
    while (true) {
        const leanToolchain = path.join(toolchainFileName)
        if (await fileExists(leanToolchain.fsPath)) {
            bestFolder = path
            bestLeanToolchain = leanToolchain
        } else if (await isCoreLean4Directory(path)) {
            bestFolder = path
            bestLeanToolchain = undefined
            // Stop searching in case users accidentally created a lean-toolchain file above the core directory
            break
        }
        if (containingWsFolderUri !== undefined && path.equals(containingWsFolderUri)) {
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

    return [bestFolder, bestLeanToolchain]
}

// Find the lean project root for the given document and return the
// Uri for the project root and the "version" information contained
// in any 'lean-toolchain' file found there.
export async function findLeanPackageVersionInfo(uri: FileUri): Promise<[FileUri, string | undefined]> {
    const [packageUri, packageFileUri] = await findLeanPackageRoot(uri)

    let version: string | undefined
    if (packageFileUri) {
        try {
            version = await readLeanVersionFile(packageFileUri)
        } catch (err) {
            logger.log(`findLeanPackageVersionInfo caught exception ${err}`)
        }
    }

    return [packageUri, version]
}

// Find the 'lean-toolchain' in the given package root and
// extract the Lean version info from it.
export async function readLeanVersion(packageUri: FileUri): Promise<string | undefined> {
    const toolchainFileName = 'lean-toolchain'
    const leanToolchain = packageUri.join(toolchainFileName)
    if (fs.existsSync(leanToolchain.fsPath)) {
        return await readLeanVersionFile(leanToolchain)
    }
    return undefined
}

async function readLeanVersionFile(packageFileUri: FileUri): Promise<string> {
    return (await fs.promises.readFile(packageFileUri.fsPath, { encoding: 'utf-8' })).trim()
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
