import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider,TextDocument,Position,CancellationToken,CompletionItem,CompletionItemKind,CompletionList,Range} from 'vscode'
import {isInputCompletion} from './util'

export class LeanInputCompletionProvider implements CompletionItemProvider {
    translations: any;

    public constructor(translations: any) {
        this.translations = translations;
    }

    public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): CompletionList {

        // The idea here is to only provide Unicode input if you are using completion triggered by a `\'.
        let offset = document.offsetAt(position);
        if (!isInputCompletion(document, position)) {
            return new CompletionList([]);
        } else {
            var items = [];
            for (var abbrev in this.translations) {
                var replacement = this.translations[abbrev];
                var item = new CompletionItem(`\\${abbrev}`, CompletionItemKind.Text);
                item.insertText = replacement;
                item.range = new Range(position.translate(0, -1), position);
                item.detail = replacement;
                items.push(item);
            }
            return new CompletionList(items);
        }
    }
}
