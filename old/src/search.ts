import { Location, Position, SymbolInformation, SymbolKind, Uri, WorkspaceSymbolProvider } from 'vscode';
import { Server } from './server';

export class LeanWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
    constructor(private server: Server) {}

    async provideWorkspaceSymbols(query: string): Promise<SymbolInformation[]> {
        const response = await this.server.search(query);
        return response.results
            .filter((item) => item.source && item.source.file &&
                item.source.line && item.source.column)
            .map((item) => {
                const loc = new Location(Uri.file(item.source.file),
                    new Position(item.source.line - 1, item.source.column));
                return new SymbolInformation(item.text, SymbolKind.Function, item.type, loc);
            });
    }
}
