/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { open, close } from 'fs';


function existsFsHelper(path: string): boolean {
    /*
    Function that helps to replace fs.existsSync (using existsSync to check for the existence
    of a file before calling fs.open(), fs.readFile() or fs.writeFile() is not recommended.
    Doing so introduces a race condition, since other processes may change the file's state between the two calls.
    Instead, user code should open/read/write the file directly and handle the error raised if the file does not exist.)
    */

    open(path, 'r', (err, fd) => {
    try {
            if (err) {
            if (err.code === 'ENOENT') {
                console.error(path + ' does not exist');
                return false
            }
            // in case of no error it will return true (which means that the file exists)
            return true
        }
    }
    finally {
        close(fd, (err) => {
        // This is an exception on closing the file
        if (err) throw err;
        });
    }
    });
    // returning false in case there is no return in other cases
    return false
}
