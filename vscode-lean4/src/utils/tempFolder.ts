
import { Disposable } from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { join, sep } from 'path';

export class TempFolder implements Disposable {
    folder : string;

    constructor(prefix: string){
        this.folder = fs.mkdtempSync(join(os.tmpdir(), prefix))
    }

    createFile(fileName : string, data : string) : string {
        const path = join(this.folder, fileName)
        fs.writeFileSync(path, data, { encoding: 'utf8'});
        return path;
    }

    dispose(): void {
        if (this.folder){
            try {
                fs.rmdirSync(this.folder, {
                    recursive: true
                })
            } catch {}
        }
    }
}
