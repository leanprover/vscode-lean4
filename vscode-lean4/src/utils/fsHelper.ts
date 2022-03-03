/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { readFile, promises, PathLike } from 'fs';


export async function fileExists(pathFile: PathLike): Promise<boolean> {
    /**
    Helper used to replace fs.existsSync (using existsSync to check for the existence
    of a file before calling fs.open(), fs.readFile() or fs.writeFile() is not recommended.
    Doing so introduces a race condition, since other processes may change the file's state between the two calls.
    Instead, user code should open/read/write the file directly and handle the error raised if the file does not exist.)
    param: pathFile - A string representing a PathLike

    returns Promise<boolean> that represents if a file exist
    **/
    return await promises.access(pathFile).then(() => true, () => false);
}

export async function fileRead(url: PathLike): Promise<string>{
    /**
    Helper async used to read a certain file using fs.readFile() function
    param: url - A string representing a PathLike

    returns Promise<string>((resolve, reject)
    **/

    return await new Promise<string>((resolve, reject) => {
        readFile(url, { encoding: 'utf-8' }, (err, data) =>{
            if (err) {
                reject(err);
            } else {
                if (data) {
                    resolve(data.trim());
                } else {
                    resolve('');
                }
            }
        });
    });
}
