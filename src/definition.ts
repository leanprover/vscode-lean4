'use strict';
import * as vscode from 'vscode'
import {DefinitionProvider, TextDocument, Position, Definition, Location, Uri} from 'vscode'
import {Server} from './server'

export class LeanDefinitionProvider implements DefinitionProvider {
    server : Server;

    public constructor(server : Server) {
        this.server = server;
    }

    public provideDefinition(document: TextDocument, position: Position,  CancellationToken): Thenable<Definition> {
        return this.server.info(document.fileName, position.line + 1, position.character).then((response) => {
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