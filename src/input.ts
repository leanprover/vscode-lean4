import {LEAN_MODE} from './constants'
import * as vscode from 'vscode'
import {CompletionItemProvider, Hover, Disposable, HoverProvider, DocumentFilter, TextEditor, TextEditorSelectionChangeEvent, TextEditorDecorationType,
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

export class LeanInputExplanationHover implements HoverProvider {
    constructor(private translations: Translations) {}

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
        const abbrevs = this.getAbbrevations(symbol).sort((a,b) => a.length - b.length);
        return abbrevs.length > 0 &&
            new Hover(`Type ${symbol} using ${abbrevs.map((a) => `\\\\${a}`).join(' or ')}`, symbolRange);
    }
}

export class LeanInputAbbreviator {
    private subscriptions: Disposable[] = [];

    private activeEditor: TextEditor;
    private range: Range;

    private decorationType: TextEditorDecorationType;

    constructor(private translations: Translations, private documentFilter: DocumentFilter) {
        this.translations = Object.assign({}, translations);
        this.translations['\\'] = '\\';

        this.decorationType = vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline',
        });

        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument((ev) => this.onChanged(ev)));
        this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.updateRange()));
        this.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((ev) => this.onSelectionChanged(ev)));
    }

    active(): boolean {
        return !!this.range;
    }

    private updateRange(range?: Range) {
        if (this.activeEditor && (!range || this.activeEditor !== vscode.window.activeTextEditor)) {
            this.activeEditor.setDecorations(this.decorationType, []);
        }

        if (range && range.isSingleLine) {
            this.activeEditor = vscode.window.activeTextEditor;
            this.range = range;

            this.activeEditor.setDecorations(this.decorationType,
                this.range ? [this.range] : []);
        } else {
            this.activeEditor = null;
            this.range = null;
        }
    }

    private rangeSize(): number {
        return this.range.end.character - this.range.start.character;
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

    private convertRange() {
        if (!this.range || this.rangeSize() < 2) return this.updateRange();

        const editor = this.activeEditor;
        const range = this.range;

        const toReplace = editor.document.getText(range);
        if (toReplace[0] !== '\\') return this.updateRange();

        const abbreviation = toReplace.slice(1);
        const replacement = this.findReplacement(abbreviation);

        if (replacement) {
            setTimeout(() => {
                // Without the timeout hack, inserting `\delta ` at the beginning of an
                // existing line would leave the cursor four characters too far right.
                editor.edit((builder) => builder.replace(range, replacement));
            }, 0);
        }

        this.updateRange();
    }

    private onChanged(ev: vscode.TextDocumentChangeEvent) {
        if (vscode.window.activeTextEditor.document !== ev.document) return; // change happened in active editor

        if (!vscode.languages.match(this.documentFilter, ev.document)) return this.updateRange(); // Lean file

        if (this.activeEditor !== vscode.window.activeTextEditor) this.updateRange();

        if (ev.contentChanges.length !== 1) return this.updateRange(); // single change
        const change = ev.contentChanges[0];

        if (change.text.length === 1 && (change.rangeLength === 0 ||
                                            (change.rangeLength === 1 &&
                                                ev.document.getText(change.range) === change.text))) {
            // insert (or right paren overwriting)
            if (!this.range) {
                if (change.text == '\\') {
                    return this.updateRange(new vscode.Range(change.range.start, change.range.start.translate(0, 1)));
                }
            } else if (change.range.start.isEqual(this.range.end)) {
                if (change.text === '\\' && this.rangeSize() === 1) { // \\
                    this.range = new vscode.Range(this.range.start, change.range.start.translate(0, 1));
                    this.convertRange();
                } else if (change.text.match(/^\s+|[)}⟩]$/)) {
                    // whitespace, closing parens
                    this.convertRange();
                }
            }
        }

        if (this.range && this.range.contains(change.range) && this.range.start.isBefore(change.range.start)) {
            // modification
            return this.updateRange(new vscode.Range(this.range.start,
                this.range.end.translate(0, change.text.length - change.rangeLength)));
        }

        this.updateRange();
    }

    private onSelectionChanged(ev: TextEditorSelectionChangeEvent) {
        if (ev.selections.length !== 1 || !this.range.contains(ev.selections[0].active)) {
            this.convertRange();
        }
    }

    dispose() {
        this.decorationType.dispose();
        for (const s of this.subscriptions)
            s.dispose();
    }
}
