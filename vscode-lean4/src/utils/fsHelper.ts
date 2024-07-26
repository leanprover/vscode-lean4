/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PathLike, promises } from 'fs'
import path from 'path'

/**
 * Returns true if `pathFile` exists and is a file
 */
export async function fileExists(pathFile: PathLike): Promise<boolean> {
    try {
        return (await promises.stat(pathFile)).isFile()
    } catch (e) {
        return false
    }
}

/**
 * Returns true if `pathFile` exists and is a directory
 */
export async function dirExists(pathFile: PathLike): Promise<boolean> {
    try {
        return (await promises.stat(pathFile)).isDirectory()
    } catch (e) {
        return false
    }
}

/**
 * This helper function is used to check if an specific file is in certain Folder.
 * @param file string that contains a file name that will be checked if it exists in a certain folder.
 * @param folder string that contains a folder name where it will check if a certain file exists
 * @returns a boolean that says if the file exists in folder
 */
export function isFileInFolder(file: string, folder: string) {
    const relative = path.relative(folder, file)
    const isSubdir = relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
    return isSubdir
}

/** Computes the relative file path of `file` in `folder`. Returns `undefined` if `file` is not in `folder`. */
export function relativeFilePathInFolder(file: string, folder: string): string | undefined {
    if (!isFileInFolder(file, folder)) {
        return undefined
    }
    return path.relative(folder, file)
}
