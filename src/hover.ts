'use strict';

import {CancellationToken, Hover, HoverProvider, MarkedString, Position, Range, TextDocument} from 'vscode';
import {Server} from './server';

export class LeanHoverProvider implements HoverProvider {
    server: Server;

    constructor(server: Server) {
        this.server = server;
    }

    async provideHover(document: TextDocument, position: Position) {
        const response = await this.server.info(document.fileName, position.line + 1, position.character);
        const marked: MarkedString[] = [];
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
        const pos = new Position(position.line - 1, position.character);
        return marked && new Hover(marked, new Range(pos, pos));
    }
}
