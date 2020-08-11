import { CancellationToken, commands, Disposable, DocumentFilter, Hover,
    HoverProvider, languages, Position, Range, Selection, TextDocument,
    TextDocumentChangeEvent, TextEditor, TextEditorDecorationType,
    TextEditorSelectionChangeEvent, window, workspace } from 'vscode';

export interface Translations { [abbrev: string]: string | null }

function inputModeEnabled(): boolean {
    return workspace.getConfiguration('lean.input').get('enabled', true);
}

function inputModeLeader(): string {
    return workspace.getConfiguration('lean.input').get('leader', '\\');
}

export function inputModeLanguages(): string[] {
    return workspace.getConfiguration('lean.input').get('languages', ['lean']);
}

function inputModeCustomTranslations(): Translations {
    return workspace.getConfiguration('lean.input').get('customTranslations', {});
}

/** Adds hover behaviour for getting translations of unicode characters. Eg: "Type ⊓ using \glb or \sqcap"  */
export class LeanInputExplanationHover implements HoverProvider, Disposable {
    private leader: string;
    private reverseTranslations: { [unicode: string]: string[] };
    private maxTranslationSize: number;

    private subscriptions: Disposable[] = [];

    constructor(private translations: Translations) {
        this.readConfig();
        this.subscriptions.push(workspace.onDidChangeConfiguration(() => this.readConfig()));
    }

    private readConfig() {
        this.leader = inputModeLeader();
        const customTranslations = inputModeCustomTranslations();

        this.maxTranslationSize = 0;
        this.reverseTranslations = {};
        const allTranslations = { ...this.translations, ...customTranslations };
        for (const abbrev of Object.getOwnPropertyNames(allTranslations)) {
            const unicode: string | null = allTranslations[abbrev];
            if (!unicode) { continue; }
            if (!this.reverseTranslations[unicode]) {
                this.reverseTranslations[unicode] = [];
            }
            this.reverseTranslations[unicode].push(abbrev);
            this.maxTranslationSize = Math.max(this.maxTranslationSize, unicode.length);
        }
        for (const unicode of Object.getOwnPropertyNames(this.reverseTranslations)) {
            this.reverseTranslations[unicode].sort((a, b) => a.length - b.length);
        }
    }

    provideHover(document: TextDocument, pos: Position, token: CancellationToken): Hover | undefined {
        const text = document.getText(new Range(pos, pos.translate(0, this.maxTranslationSize)));
        const allAbbrevs = Array(text.length).fill(undefined).map((_, i) => text.substr(0, i+1))
            .filter((init) => this.reverseTranslations[init])
            .map((init) => ({ unicode: init, abbrevs: this.reverseTranslations[init] }))
            .reverse();
        if (allAbbrevs.length === 0) {
            return;
        }

        const hoverMarkdown =
            allAbbrevs.map(({unicode, abbrevs}) =>
                    `Type ${unicode} using ${abbrevs.map((a) => '`' + this.leader + a + '`').join(' or ')}`)
                .join('\n\n');
        const maxUnicodeLen = allAbbrevs[0].unicode.length;
        const hoverRange = new Range(pos, pos.translate(0, maxUnicodeLen));
        return new Hover(hoverMarkdown, hoverRange);
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
/* Each editor has their own abbreviation handler. */
class TextEditorAbbrevHandler {
    ranges: (Range | undefined)[] = [];

    constructor(public editor: TextEditor, private abbreviator: LeanInputAbbreviator) {}

    private async updateRanges(ranges: Range[]) {
        this.ranges = ranges;

        this.editor.setDecorations(this.abbreviator.decorationType, ranges);
        await this.abbreviator.updateInputActive();

        // HACK: support \{{}} and \[[]]
        const hackyReplacements: {[input: string]: string} = {
            [this.leader + '{{}}']: '⦃⦄',
            [this.leader + '[[]]']: '⟦⟧',
            [this.leader + '<>']: '⟨⟩',
            [this.leader + '([])'] : '⟮⟯',
            [this.leader + 'f<>']: '‹›',
            [this.leader + 'f<<>>']: '«»',
        };

        await this.editor.edit((builder) => {
            ranges.forEach(range => {
                const replacement = hackyReplacements[this.editor.document.getText(range)];

                if(replacement) {
                    builder.replace(range, replacement);
                    const pos = range.start.translate(0, 1);
                    this.editor.selection = new Selection(pos, pos);
                }
            })
        })
    }

    get leader(): string { return this.abbreviator.leader; }
    get enabled(): boolean { return this.abbreviator.enabled; }

    async convertRanges(trailingLeader: boolean = false) {
        const newRanges : Range[] = [];

        await this.editor.edit((builder) => {
            this.ranges.forEach(range => {
                const toReplace = this.editor.document.getText(range);

                const abbreviation = toReplace.slice(1);
                const replacement = toReplace.startsWith(this.leader) && this.abbreviator.findReplacement(abbreviation);

                if(replacement) builder.replace(range, replacement)
                if(trailingLeader) {
                    newRanges.push(new Range(
                        range.end.translate(0, replacement.length - (toReplace.length + 1)),
                        range.end.translate(0, replacement.length - toReplace.length)
                    ))
                }
            })
        })

        await this.updateRanges(newRanges);
    }

    async onChanged({ contentChanges: changes }: TextDocumentChangeEvent) {
        if (changes.length === 0) {
            // This event is triggered by files.autoSave=onDelay
            return;
        }

        const ranges : Range[] = []
        let isInsert : boolean

        changes.forEach(change => {
            const existingRange = this.ranges.find(range => range.contains(change.range) && range.start.isBefore(change.range.start));

            // insert
            if (!existingRange && change.text === this.leader) {
                ranges.push(new Range(change.range.start, change.range.start.translate(0, 1)));
                isInsert = true;
            }

            if (existingRange) {
                // modification
                ranges.push(new Range(existingRange.start,
                    existingRange.end.translate(0, change.text.length - change.rangeLength)));
            }
        })

        await this.updateRanges(ranges)

        if(!isInsert && changes.every(change => /^\s+$/.exec(change.text) || change.text === this.leader)) {
            await this.convertRanges(changes[0].text === this.leader);
        }
    }

    async onSelectionChanged(ev: TextEditorSelectionChangeEvent) {
        const rangesUnselected = this.ranges.every(range => {
            return !ev.selections.some(selection => range.contains(selection.active))
        })

        if (rangesUnselected) {
            await this.convertRanges();
        }
    }
}

export class LeanInputAbbreviator {
    private subscriptions: Disposable[] = [];
    leader = inputModeLeader();
    enabled = inputModeEnabled();
    languages = inputModeLanguages();
    customTranslations = inputModeCustomTranslations();
    allTranslations: Translations;

    private handlers = new Map<TextEditor, TextEditorAbbrevHandler>();

    decorationType: TextEditorDecorationType;

    constructor(private translations: Translations) {
        this.translations = Object.assign({}, translations);
        this.allTranslations = {...this.translations, ...this.customTranslations};

        this.decorationType = window.createTextEditorDecorationType({
            textDecoration: 'underline',
        });

        this.subscriptions.push(workspace.onDidChangeTextDocument((ev) => this.onChanged(ev)));
        this.subscriptions.push(window.onDidChangeTextEditorSelection((ev) => this.onSelectionChanged(ev)));

        this.subscriptions.push(window.onDidChangeVisibleTextEditors((editors) => {
            // delete removed editors
            const handlers = new Map<TextEditor, TextEditorAbbrevHandler>();
            this.handlers.forEach((h, e) => {
                if (editors.includes(e)) {
                    handlers.set(e, h);
                }
            });
            this.handlers = handlers;
        }));

        this.subscriptions.push(window.onDidChangeActiveTextEditor(() => this.updateInputActive()));

        this.subscriptions.push(commands.registerTextEditorCommand('lean.input.convert', async (editor, edit) => {
            const handler = this.handlers.get(editor);
            if (handler) {
                await handler.convertRanges();
            }
        }));

        this.subscriptions.push(commands.registerTextEditorCommand('lean.input.convertWithNewline', async (editor) => {
            const handler = this.handlers.get(editor);
            if (handler) {
                await handler.convertRanges();
            }

            return commands.executeCommand('type', { source: 'keyboard', text: '\n' });
        }));

        this.subscriptions.push(workspace.onDidChangeConfiguration(() => {
            this.leader = inputModeLeader();
            this.enabled = inputModeEnabled();
            this.languages = inputModeLanguages();
            this.customTranslations = inputModeCustomTranslations();
            this.allTranslations = {...this.translations, ...this.customTranslations};
        }));
    }

    private async setInputActive(isActive: boolean) {
        await commands.executeCommand('setContext', 'lean.input.isActive', isActive);
    }

    get active(): boolean {
        const handler = this.handlers.get(window.activeTextEditor);
        return handler && (handler.ranges.length > 0);
    }

    async updateInputActive(): Promise<void> {
        await this.setInputActive(this.active);
    }

    findReplacement(typedAbbrev: string): string | undefined {
        if (typedAbbrev === '') { return undefined; }

        if (this.allTranslations[typedAbbrev]) { return this.allTranslations[typedAbbrev]; }

        let shortestExtension: string = null;
        for (const abbrev in this.allTranslations) {
            if (abbrev.startsWith(typedAbbrev) && (!shortestExtension || abbrev.length < shortestExtension.length)) {
                shortestExtension = abbrev;
            }
        }

        if (shortestExtension) {
            return this.allTranslations[shortestExtension];
        } else if (typedAbbrev) {
            const prefixReplacement = this.findReplacement(
                typedAbbrev.slice(0, typedAbbrev.length - 1));
            if (prefixReplacement) {
                return prefixReplacement + typedAbbrev.slice(typedAbbrev.length - 1);
            }
        }
        return null;
    }

    private isSupportedFile(document: TextDocument) {
        return !!languages.match(this.languages,document);
    }

    private async onChanged(ev: TextDocumentChangeEvent) {
        const editor = window.activeTextEditor;

        if (editor.document !== ev.document) { return; } // change happened in active editor

        if (!this.isSupportedFile(ev.document)) { return; } // Not a supported file

        if (!this.handlers.has(editor)) {
            this.handlers.set(editor, new TextEditorAbbrevHandler(editor, this));
        }
        await this.handlers.get(editor).onChanged(ev);
    }

    private async onSelectionChanged(ev: TextEditorSelectionChangeEvent) {
        const editor = window.activeTextEditor;

        if (editor !== ev.textEditor) { return; } // change happened in active editor

        if (!this.isSupportedFile(editor.document)) { return; } // Lean file

        if (this.handlers.has(editor)) {
            await this.handlers.get(editor).onSelectionChanged(ev);
        }
    }

    dispose(): void {
        this.decorationType.dispose();
        for (const s of this.subscriptions) {
            s.dispose();
        }
    }
}
