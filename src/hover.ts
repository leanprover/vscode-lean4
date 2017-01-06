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
            // Maybe use more sohpisticated typing here?
            if (response.record && response.record['full-id']) {
                let msg = response.record['full-id'] + ' : ' + response.record['type'];
                let marked = { language: 'lean', value: msg };
                return new Hover(marked, new vscode.Range(position.line - 1, position.character, position.line - 1, position.character));
            } else if (response.record && response.record.state) {
                let marked = { language: 'lean', value: response.record.state };
                return new Hover(marked, new vscode.Range(position.line - 1, position.character, position.line - 1, position.character));
            } else {
                return null;
            }
        });
    }
}
