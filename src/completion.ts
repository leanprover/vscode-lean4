import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider} from 'vscode'
import {Server} from './server'

export class LeanCompletionItemProvider implements vscode.CompletionItemProvider {
    server : Server;

    public constructor(server : Server) {
        this.server = server;
    }

    public provideCompletionItems(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.CompletionItem[]> {
            let wordRange = document.getWordRangeAtPosition(position);
            let pattern = document.getText(wordRange);
            return this.server.complete(document.fileName, position.line, pattern).then((message : { completions : Array<any>}) => {
                return message.completions.map((completion) => {
                    let item = new vscode.CompletionItem(completion.text, vscode.CompletionItemKind.Variable);
                    item.detail = completion.type;
                    return item;
                });
            });
    }
}
