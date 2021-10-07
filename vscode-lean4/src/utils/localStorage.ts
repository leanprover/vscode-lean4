'use strict';

// Copied from this awesome blog:
// https://www.chrishasz.com/blog/2020/07/28/vscode-how-to-use-local-storage-api/

import { Memento } from 'vscode';

export class LocalStorageService {

    constructor(private storage: Memento) { }

    getLeanPath() : string
    {
        return this.storage.get<string>('LeanPath', null);
    }

    setLeanPath(path) : void
    {
        void this.storage.update('LeanPath', path);
    }
}
