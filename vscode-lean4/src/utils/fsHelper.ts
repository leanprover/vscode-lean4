/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {promises, PathLike } from 'fs';

/**
    Helper used to replace fs.existsSync (using existsSync to check for the existence
    of a file before calling fs.open(), fs.readFile() or fs.writeFile() is not recommended.
    Doing so introduces a race condition, since other processes may change the file's state between the two calls.
    Instead, user code should open/read/write the file directly and handle the error raised if the file does not exist.)
    param: pathFile - A string representing a PathLike

    returns Promise<boolean> that represents if a file exist
**/
export async function fileExists(pathFile: PathLike): Promise<boolean> {
    return await promises.access(pathFile).then(() => true, () => false);
}
