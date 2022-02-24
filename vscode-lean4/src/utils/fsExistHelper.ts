/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { promises, PathLike } from 'fs';


export async function fsExistHelper(pathFile: PathLike): Promise<boolean> {
    /*
    Helper used to replace fs.existsSync (using existsSync to check for the existence
    of a file before calling fs.open(), fs.readFile() or fs.writeFile() is not recommended.
    Doing so introduces a race condition, since other processes may change the file's state between the two calls.
    Instead, user code should open/read/write the file directly and handle the error raised if the file does not exist.)
    */
    return await promises.access(pathFile).then(() => true, () => false);
}
