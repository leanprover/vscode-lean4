'use strict';

import {CancellationToken, Hover, HoverProvider, Position, Range, TextDocument} from 'vscode';
import {Server} from './server';

export class LeanHoverProvider implements HoverProvider {
    server: Server;

    constructor(server: Server) {
        this.server = server;
    }

    provideHover(document: TextDocument, position: Position): Thenable<Hover> {
        return this.server.info(document.fileName, position.line + 1, position.character).then((response) => {
            // Maybe use more sohpisticated typing here?
            const marked = [];
            if (response.record) {
                const name = response.record['full-id'] || response.record.text;
                if (name) {
                    if (response.record.tactic_params) {
                        marked.push({ language: 'text', value: name + ' ' + response.record.tactic_params.join(' ') });
                    } else {
                        marked.push({ language: 'lean', value: name + ' : ' + response.record.type });
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
                const pos = new Position(position.line - 1, position.character);
                return new Hover(marked, new Range(pos, pos));
            } else {
                return null;
            }
        });
    }
}
