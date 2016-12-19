import * as vscode from 'vscode'
import {DefinitionProvider, TextDocument, Position, Definition, Location, Uri} from 'vscode'
import {Server} from './server'
import * as util from './util';

export class LeanDefinitionProvider implements DefinitionProvider {
    server : Server;

    public constructor(server : Server) {
        this.server = server;
    }

    public provideDefinition(document: TextDocument, position: Position,  CancellationToken): Thenable<Definition> {
        let startPos = util.identifierStart(document, position);
        return this.server.info(document.fileName, startPos.line + 1, startPos.character).then((response) => {
            if (response.record && response.record.source) {
                let src = response.record.source;
                let uri = src.file ? Uri.file(src.file) : document.uri;
                return new Location(uri, new Position(src.line - 1, src.column));
            } else {
                return null;
            }
        });
    }
}