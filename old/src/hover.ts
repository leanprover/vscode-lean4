import { Hover, HoverProvider, MarkdownString, Position, Range, TextDocument } from 'vscode';
import { Server } from './server';

export class LeanHoverProvider implements HoverProvider {
    server: Server;

    constructor(server: Server) {
        this.server = server;
    }

    async provideHover(document: TextDocument, position: Position): Promise<Hover> {
        const response = await this.server.info(document.fileName, position.line + 1, position.character);
        if (response.record) {
            const contents: MarkdownString[] = [];
            const name = response.record['full-id'] || response.record.text;
            if (name) {
                if (response.record.tactic_params) {
                    contents.push(new MarkdownString()
                        .appendText(name + ' ' + response.record.tactic_params.join(' ')));
                } else {
                    contents.push(new MarkdownString()
                        .appendCodeblock(name + ' : ' + response.record.type, 'lean'));
                }
            }
            if (response.record.doc) {
                contents.push(new MarkdownString()
                    .appendMarkdown(response.record.doc));
            }
            if (response.record.state && !contents) {
                contents.push(new MarkdownString()
                    .appendCodeblock(response.record.state, 'lean'));
            }
            const pos = new Position(position.line - 1, position.character);
            return new Hover(contents, new Range(pos, pos));
        }
    }
}
