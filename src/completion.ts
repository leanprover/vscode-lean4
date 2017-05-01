import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider} from 'vscode'
import {Server} from './server'
import {isInputCompletion} from './util'

export class LeanCompletionItemProvider implements vscode.CompletionItemProvider {
    server : Server;

    public constructor(server : Server) {
        this.server = server;
    }

    public provideCompletionItems(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.CompletionItem[]> {
            // TODO(gabriel): use LeanInputAbbreviator.active() instead
            if (!isInputCompletion(document, position)) {
                return this.server.complete(document.fileName, position.line+1, position.character).then(message => {
                    return message.completions.map((completion) => {
                        let item = new vscode.CompletionItem(completion.text, vscode.CompletionItemKind.Function);
                        item.range = new vscode.Range(position.translate(0, -message.prefix.length), position);
                        if (completion.tactic_params) {
                            item.detail = completion.tactic_params.join(' ');
                        } else {
                            item.detail = completion.type;
                        }
                        item.documentation = completion.doc;
                        return item;
                    });
                });
            } else {
                return null;
            }
    }
}
