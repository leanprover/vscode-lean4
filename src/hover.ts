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
            let marked = [];
            if (response.record) {
                let name = response.record['full-id'] || response.record['text'];
                if (name) {
                    let msg;
                    if (response.record.tactic_params) {
                        marked.push({ language: 'text', value: name + ' ' + response.record.tactic_params.join(' ') });
                    } else {
                        marked.push({ language: 'lean', value: name + ' : ' + response.record['type'] });
                    }
                }
                if (response.record.doc) {
                    marked.push(response.record.doc);
                }
                if (response.record.state && !marked) {
                    marked.push({ language: 'lean', value: response.record.state });
                }
            }
            if (marked) {
                return new Hover(marked, new vscode.Range(position.line - 1, position.character, position.line - 1, position.character));
            } else {
                return null;
            }
        });
    }
}
