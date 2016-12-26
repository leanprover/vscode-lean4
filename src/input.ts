import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider,TextDocument,Position,CancellationToken,CompletionItem,CompletionItemKind,CompletionList,Range} from 'vscode'

export class LeanInputCompletionProvider implements CompletionItemProvider {
    translations: any;

    public constructor(translations: any) {
        this.translations = translations;
    }

    public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): CompletionList {
        var items = [];
        for (var abbrev in this.translations) {
            var repl = this.translations[abbrev];
            var item = new CompletionItem(`\\${abbrev}`, CompletionItemKind.Text);
            item.insertText = repl;
            item.range = new Range(position.translate(0,-1), position);
            items.push(item);
        }
        return new CompletionList(items);
    }
}
