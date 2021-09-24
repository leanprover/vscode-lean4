'use strict';

// Copied from this awesome blog:
// https://www.chrishasz.com/blog/2020/07/28/vscode-how-to-use-local-storage-api/

import { Memento } from 'vscode';

export class LocalStorageService {

    constructor(private storage: Memento) { }

    getValue<T>(key : string) : T{
        return this.storage.get<T>(key, null);
    }

    setValue<T>(key : string, value : T) : void {
        void this.storage.update(key, value );
    }
}
