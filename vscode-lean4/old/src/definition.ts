import { Definition, DefinitionProvider, Location, Position, TextDocument, Uri } from 'vscode';
import { Server } from './server';

export class LeanDefinitionProvider implements DefinitionProvider {
    server: Server;

    constructor(server: Server) {
        this.server = server;
    }

    async provideDefinition(document: TextDocument, position: Position): Promise<Definition> {
        const response = await this.server.info(document.fileName, position.line + 1, position.character);
        if (response.record && response.record.source) {
            const src = response.record.source;
            const uri = src.file ? Uri.file(src.file) : document.uri;
            return new Location(uri, new Position(src.line - 1, src.column));
        } else {
            return null;
        }
    }
}
