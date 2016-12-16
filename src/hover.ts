'use strict';

import * as vscode from 'vscode';
import {Server} from './server';
import {HoverProvider, Hover, TextDocument, Position, CancellationToken} from 'vscode';

export class LeanHoverProvider implements HoverProvider {
    server : Server;

    public constructor(server : Server) {
        this.server = server;
    }

    public provideHover(document : TextDocument, position : Position, CancellationToken) : Thenable<Hover> {
        return this.server.info(document.fileName, position.line + 1, position.character).then((response) => {
            if (response.record) {
                let msg = response.record['full-id'] + ' : ' + response.record['type'];
                let marked = { language: 'lean', value: msg };
                return new Hover(marked, new vscode.Range(position.line, position.character, position.line, position.character));
            } else {
                return null;
            }
        });
    }
}
