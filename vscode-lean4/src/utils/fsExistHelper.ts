/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { open, close } from 'fs';


export function fsExistHelper(pathFile: any): boolean {
    /*
    Helper used to replace fs.existsSync (using existsSync to check for the existence
    of a file before calling fs.open(), fs.readFile() or fs.writeFile() is not recommended.
    Doing so introduces a race condition, since other processes may change the file's state between the two calls.
    Instead, user code should open/read/write the file directly and handle the error raised if the file does not exist.)
    */
    let res = true;
    open(pathFile.toString(), 'r', (err, fd) => {
        if (err) {
            if (err.code === 'ENOENT') {
                //myfile does not exist'
                res = false;
            }

        throw err;
        }

        close(fd, (err) => {
            if (err) throw err;
        });

    });
    return res;
}
