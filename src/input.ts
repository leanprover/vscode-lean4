import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider, Hover, Disposable, HoverProvider, DocumentFilter,
    TextDocument,Position,CancellationToken,CompletionItem,CompletionItemKind,CompletionList,Range} from 'vscode'
import {isInputCompletion} from './util'

export type Translations = { [abbrev: string]: string };

export class LeanInputCompletionProvider implements CompletionItemProvider {
    translations: Translations;

    public constructor(translations: Translations) {
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

export class LeanInputAbbreviator implements HoverProvider {
    translations: { [short: string]: string };
    documentFilter: DocumentFilter;
    private changedSubscription: Disposable;
    private explainSubscription: Disposable;

    constructor(translations: Translations, documentFilter: DocumentFilter) {
        this.translations = translations;
        this.documentFilter = documentFilter;

        this.changedSubscription =
            vscode.workspace.onDidChangeTextDocument((ev) => this.onChanged(ev));
        this.explainSubscription = vscode.languages.registerHoverProvider(documentFilter, this);
    }

    private findBackslashPosition(document: TextDocument, position: Position): Position | undefined {
        const line = document.lineAt(position).text;
        let offset = position.character;
        do { offset--; } while (/[^\\\s]/.test(line.charAt(offset)));
        return line.charAt(offset) === '\\' && new Position(position.line, offset);
    }

    private findReplacement(typedAbbrev: string): string | undefined {
        if (this.translations[typedAbbrev]) return this.translations[typedAbbrev];

        let shortestExtension: string = null;
        for (const abbrev in this.translations) {
            if (abbrev.startsWith(typedAbbrev) && (!shortestExtension || abbrev.length < shortestExtension.length)) {
                shortestExtension = abbrev;
            }
        }

        return shortestExtension && this.translations[shortestExtension];
    }

    private onChanged(ev: vscode.TextDocumentChangeEvent) {
        if (!vscode.languages.match(this.documentFilter, ev.document)) return; // Lean file

        if (ev.contentChanges.length !== 1) return; // single change
        const change = ev.contentChanges[0];
        if (change.rangeLength !== 0) return; // insert

        if (change.text !== ' ') return; // space

        let editor = vscode.window.activeTextEditor;
        if (editor.document !== ev.document) return; // change happened in active editor

        const end = change.range.end;
        const beforeBackslash = this.findBackslashPosition(ev.document, end);
        if (!beforeBackslash) return; // \abbrev left of insert
        const afterBackslash = beforeBackslash.translate(0, 1);

        const abbreviation = ev.document.getText(new vscode.Range(afterBackslash, end));
        const replacement = this.findReplacement(abbreviation);
        if (!replacement) return; // unknown translation

        const newEnd = beforeBackslash.translate(0, replacement.length);

        setTimeout(() => {
            // Without the timeout hack, inserting `\delta ` at the beginning of an
            // existing line would leave the cursor four characters too far right.
            // editor.selections = editor.selections.slice(0);
            editor.edit((builder) => builder.replace(new vscode.Range(beforeBackslash, end), replacement));
        }, 0);
    }

    getAbbrevations(symbol: string): string[] {
        const abbrevs: string[] = [];
        for (let k in this.translations) {
            if (this.translations[k] === symbol) abbrevs.push(k);
        }
        return abbrevs;
    }

    provideHover(document: vscode.TextDocument, pos: Position, token: vscode.CancellationToken): Hover | undefined {
        const symbolRange = new vscode.Range(pos, pos.translate(0, 1));
        const symbol = document.getText(symbolRange);
        const abbrevs = this.getAbbrevations(symbol);
        return abbrevs.length > 0 &&
            new Hover(`Type ${symbol} using ${abbrevs.map((a) => `\\\\${a}`).join(' or ')}`, symbolRange);
    }

    dispose() {
        this.changedSubscription.dispose();
        this.explainSubscription.dispose();
    }
}
