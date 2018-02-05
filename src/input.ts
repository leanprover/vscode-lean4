import * as vscode from 'vscode';
import {CancellationToken, CompletionItem, CompletionItemKind, CompletionItemProvider,
    CompletionList, Disposable, DocumentFilter, Hover,
    HoverProvider, Position, Range, Selection, TextDocument, TextEditor,
    TextEditorDecorationType, TextEditorSelectionChangeEvent, Uri} from 'vscode';
import {LEAN_MODE} from './constants';
import {isInputCompletion} from './util';

export interface Translations { [abbrev: string]: string; }

export class LeanInputExplanationHover implements HoverProvider {
    constructor(private translations: Translations) {}

    getAbbrevations(symbol: string): string[] {
        const abbrevs: string[] = [];
        for (const k in this.translations) {
            if (this.translations[k] === symbol) { abbrevs.push(k); }
        }
        return abbrevs;
    }

    provideHover(document: vscode.TextDocument, pos: Position, token: vscode.CancellationToken): Hover | undefined {
        const symbolRange = new vscode.Range(pos, pos.translate(0, 1));
        const symbol = document.getText(symbolRange);
        const abbrevs = this.getAbbrevations(symbol).sort((a, b) => a.length - b.length);
        return abbrevs.length > 0 &&
            new Hover(`Type ${symbol} using ${abbrevs.map((a) => `\\\\${a}`).join(' or ')}`, symbolRange);
    }
}

class TextEditorAbbrevHandler {
    range: Range;

    constructor(public editor: TextEditor, private abbreviator: LeanInputAbbreviator) {}

    private updateRange(range?: Range) {
        if (range && !range.isSingleLine) { range = null; }
        this.range = range;
        this.editor.setDecorations(this.abbreviator.decorationType, range ? [range] : []);

        // HACK: support \{{}}
        if (range && this.editor.document.getText(range) === '\\{{}}') {
            this.editor.edit(async (builder) => {
                await builder.replace(range, '⦃⦄');
                const pos = range.start.translate(0, 1);
                this.editor.selection = new Selection(pos, pos);
                this.updateRange();
            });
        }
    }

    get rangeSize(): number {
        return this.range.end.character - this.range.start.character;
    }

    private convertRange(newRange?: Range) {
        if (!this.range || this.rangeSize < 2) { return this.updateRange(); }

        const range = this.range;

        const toReplace = this.editor.document.getText(range);
        if (toReplace[0] !== '\\') { return this.updateRange(); }

        const abbreviation = toReplace.slice(1);
        const replacement = this.abbreviator.findReplacement(abbreviation);

        if (replacement) {
            setTimeout(() => {
                // Without the timeout hack, inserting `\delta ` at the beginning of an
                // existing line would leave the cursor four characters too far right.
                this.editor.edit(async (builder) => {
                    await builder.replace(range, replacement);
                    if (newRange) {
                        this.updateRange(new vscode.Range(
                            newRange.start.translate(0, replacement.length - toReplace.length),
                            newRange.end.translate(0, replacement.length - toReplace.length)));
                    }
                });
            }, 0);
        }

        this.updateRange(newRange);
    }

    onChanged(ev: vscode.TextDocumentChangeEvent) {
        if (ev.contentChanges.length !== 1) { return this.updateRange(); } // single change
        const change = ev.contentChanges[0];

        if (change.text.length === 1 && (change.rangeLength === 0 ||
                                            (change.rangeLength === 1 &&
                                                ev.document.getText(change.range) === change.text))) {
            // insert (or right paren overwriting)
            if (!this.range) {
                if (change.text === '\\') {
                    return this.updateRange(new vscode.Range(change.range.start, change.range.start.translate(0, 1)));
                }
            } else if (change.range.start.isEqual(this.range.end)) {
                if (change.text === '\\' && this.rangeSize === 1) { // \\
                    this.range = new vscode.Range(this.range.start, change.range.start.translate(0, 1));
                    return this.convertRange();
                } else if (change.text.match(/^\s+|[)}⟩\\]$/)) {
                    // whitespace, closing parens, backslash
                    return this.convertRange(change.text !== '\\' ? null :
                        new vscode.Range(change.range.start, change.range.start.translate(0, 1)));
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

    onSelectionChanged(ev: TextEditorSelectionChangeEvent) {
        if (ev.selections.length !== 1 || !this.range.contains(ev.selections[0].active)) {
            this.convertRange();
        }
    }
}

export class LeanInputAbbreviator {
    private subscriptions: Disposable[] = [];

    private handlers = new Map<TextEditor, TextEditorAbbrevHandler>();

    decorationType: TextEditorDecorationType;

    constructor(private translations: Translations, public documentFilter: DocumentFilter) {
        this.translations = Object.assign({}, translations);
        this.translations['\\'] = '\\';

        this.decorationType = vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline',
        });

        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument((ev) => this.onChanged(ev)));
        this.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((ev) => this.onSelectionChanged(ev)));

        this.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors) => {
            // delete removed editors
            const handlers = new Map<TextEditor, TextEditorAbbrevHandler>();
            this.handlers.forEach((h, e) => {
                if (editors.indexOf(e) !== -1) {
                    handlers.set(e, h);
                }
            });
            this.handlers = handlers;
        }));
    }

    get active(): boolean {
        return !!this.handlers.get(vscode.window.activeTextEditor);
    }

    findReplacement(typedAbbrev: string): string | undefined {
        if (this.translations[typedAbbrev]) { return this.translations[typedAbbrev]; }

        let shortestExtension: string = null;
        for (const abbrev in this.translations) {
            if (abbrev.startsWith(typedAbbrev) && (!shortestExtension || abbrev.length < shortestExtension.length)) {
                shortestExtension = abbrev;
            }
        }

        if (shortestExtension) {
            return this.translations[shortestExtension];
        } else if (typedAbbrev) {
            const prefixReplacement = this.findReplacement(
                typedAbbrev.slice(0, typedAbbrev.length - 1));
            if (prefixReplacement) {
                return prefixReplacement + typedAbbrev.slice(typedAbbrev.length - 1);
            }
        }
        return null;
    }

    private onChanged(ev: vscode.TextDocumentChangeEvent) {
        const editor = vscode.window.activeTextEditor;

        if (editor.document !== ev.document) { return; } // change happened in active editor

        if (!vscode.languages.match(this.documentFilter, ev.document)) { return; } // Lean file

        if (!this.handlers.has(editor)) {
            this.handlers.set(editor, new TextEditorAbbrevHandler(editor, this));
        }
        this.handlers.get(editor).onChanged(ev);
    }

    private onSelectionChanged(ev: TextEditorSelectionChangeEvent) {
        const editor = vscode.window.activeTextEditor;

        if (editor !== ev.textEditor) { return; } // change happened in active editor

        if (!vscode.languages.match(this.documentFilter, editor.document)) { return; } // Lean file

        if (this.handlers.has(editor)) {
            this.handlers.get(editor).onSelectionChanged(ev);
        }
    }

    dispose() {
        this.decorationType.dispose();
        for (const s of this.subscriptions) {
            s.dispose();
        }
    }
}
