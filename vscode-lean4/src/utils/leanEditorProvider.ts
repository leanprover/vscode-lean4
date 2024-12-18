import {
    commands,
    Disposable,
    EventEmitter,
    ExtensionContext,
    TextDocument,
    TextEditor,
    TextEditorEdit,
    TextEditorSelectionChangeEvent,
    window,
    workspace,
} from 'vscode'
import { ExtUri, isExtUri, toExtUriOrError } from './exturi'
import { groupByKey, groupByUniqueKey } from './groupBy'

export class LeanDocument {
    constructor(
        readonly doc: TextDocument,
        readonly extUri: ExtUri,
    ) {}

    equals(other: LeanDocument): boolean {
        return this.doc === other.doc
    }

    equalsTextDocument(other: TextDocument): boolean {
        return this.doc === other
    }

    static equalsWithUndefined(a: LeanDocument | undefined, b: LeanDocument | undefined): boolean {
        if (a === undefined) {
            return b === undefined
        }
        if (b === undefined) {
            return a === undefined
        }
        return a.equals(b)
    }
}

export class LeanEditor {
    constructor(
        readonly editor: TextEditor,
        readonly documentExtUri: ExtUri,
    ) {}

    equals(other: LeanEditor): boolean {
        return this.editor === other.editor
    }

    equalsTextEditor(other: TextEditor): boolean {
        return this.editor === other
    }

    static equalsWithUndefined(a: LeanEditor | undefined, b: LeanEditor | undefined): boolean {
        if (a === undefined) {
            return b === undefined
        }
        if (b === undefined) {
            return a === undefined
        }
        return a.equals(b)
    }
}

class LeanDocumentIndex {
    private docsByUri: Map<string, LeanDocument>

    /**
     * Assumes that `docs` only contains at most one `LeanDocument` per URI.
     * This is given for `TextDocument`s from VS Code.
     * */
    constructor(docs: LeanDocument[]) {
        this.docsByUri = groupByUniqueKey(docs, doc => doc.extUri.toString())
    }

    get(uri: ExtUri): LeanDocument | undefined {
        return this.docsByUri.get(uri.toString())
    }
}

class LeanEditorIndex {
    private editorsByUri: Map<string, LeanEditor[]>

    constructor(editors: LeanEditor[]) {
        this.editorsByUri = groupByKey(editors, editor => editor.documentExtUri.toString())
    }

    get(uri: ExtUri): LeanEditor[] | undefined {
        return this.editorsByUri.get(uri.toString())
    }
}

export function isLeanDocument(doc: TextDocument): boolean {
    return isExtUri(doc.uri) && doc.languageId === 'lean4'
}

export function asLeanDocument(doc: TextDocument): LeanDocument | undefined {
    if (isLeanDocument(doc)) {
        return new LeanDocument(doc, toExtUriOrError(doc.uri))
    }
    return undefined
}

export function filterLeanDocuments(docs: readonly TextDocument[]): LeanDocument[] {
    return docs.map(doc => asLeanDocument(doc)).filter(doc => doc !== undefined)
}

export function filterLeanDocument(doc: TextDocument | undefined): LeanDocument | undefined {
    if (doc === undefined) {
        return undefined
    }
    return asLeanDocument(doc)
}

export function isLeanEditor(editor: TextEditor): boolean {
    return isLeanDocument(editor.document)
}

export function asLeanEditor(editor: TextEditor): LeanEditor | undefined {
    if (isLeanEditor(editor)) {
        return new LeanEditor(editor, toExtUriOrError(editor.document.uri))
    }
    return undefined
}

export function filterLeanEditors(editors: readonly TextEditor[]): LeanEditor[] {
    return editors.map(editor => asLeanEditor(editor)).filter(editor => editor !== undefined)
}

export function filterLeanEditor(editor: TextEditor | undefined): LeanEditor | undefined {
    if (editor === undefined) {
        return undefined
    }
    return asLeanEditor(editor)
}

export class LeanEditorProvider implements Disposable {
    private subscriptions: Disposable[] = []

    private _visibleLeanEditors: LeanEditor[]
    private visibleLeanEditorsByUri: LeanEditorIndex
    private readonly onDidChangeVisibleLeanEditorsEmitter = new EventEmitter<readonly LeanEditor[]>()
    readonly onDidChangeVisibleLeanEditors = this.onDidChangeVisibleLeanEditorsEmitter.event

    private _activeLeanEditor: LeanEditor | undefined
    private readonly onDidChangeActiveLeanEditorEmitter = new EventEmitter<LeanEditor | undefined>()
    readonly onDidChangeActiveLeanEditor = this.onDidChangeActiveLeanEditorEmitter.event

    private _lastActiveLeanEditor: LeanEditor | undefined
    private readonly onDidChangeLastActiveLeanEditorEmitter = new EventEmitter<LeanEditor | undefined>()
    readonly onDidChangeLastActiveLeanEditor = this.onDidChangeLastActiveLeanEditorEmitter.event

    private _leanDocuments: LeanDocument[]
    private leanDocumentsByUri: LeanDocumentIndex
    private readonly onDidChangeLeanDocumentsEmitter = new EventEmitter<readonly LeanDocument[]>()
    readonly onDidChangeLeanDocuments = this.onDidChangeLeanDocumentsEmitter.event
    private readonly onDidOpenLeanDocumentEmitter = new EventEmitter<LeanDocument>()
    readonly onDidOpenLeanDocument = this.onDidOpenLeanDocumentEmitter.event
    private readonly onDidCloseLeanDocumentEmitter = new EventEmitter<LeanDocument>()
    readonly onDidCloseLeanDocument = this.onDidCloseLeanDocumentEmitter.event

    private _lastActiveLeanDocument: LeanDocument | undefined
    private readonly onDidChangeLastActiveLeanDocumentEmitter = new EventEmitter<LeanDocument | undefined>()
    readonly onDidChangeLastActiveLeanDocument = this.onDidChangeLastActiveLeanDocumentEmitter.event

    private readonly onDidRevealLeanEditorEmitter = new EventEmitter<LeanEditor>()
    readonly onDidRevealLeanEditor = this.onDidRevealLeanEditorEmitter.event
    private readonly onDidConcealLeanEditorEmitter = new EventEmitter<LeanEditor>()
    readonly onDidConcealLeanEditor = this.onDidConcealLeanEditorEmitter.event

    private readonly onDidChangeLeanEditorSelectionEmitter = new EventEmitter<TextEditorSelectionChangeEvent>()
    readonly onDidChangeLeanEditorSelection = this.onDidChangeLeanEditorSelectionEmitter.event

    constructor() {
        this._visibleLeanEditors = filterLeanEditors(window.visibleTextEditors)
        this.visibleLeanEditorsByUri = new LeanEditorIndex(this._visibleLeanEditors)
        this.subscriptions.push(window.onDidChangeVisibleTextEditors(editors => this.updateVisibleTextEditors(editors)))

        this._activeLeanEditor = filterLeanEditor(window.activeTextEditor)
        this.subscriptions.push(window.onDidChangeActiveTextEditor(editor => this.updateActiveTextEditor(editor)))

        this._leanDocuments = filterLeanDocuments(workspace.textDocuments)
        this.leanDocumentsByUri = new LeanDocumentIndex(this._leanDocuments)
        this.subscriptions.push(
            workspace.onDidOpenTextDocument(doc => {
                this.updateLeanDocuments(workspace.textDocuments)
                this.openLeanDocument(doc)
                // Update visible and active editors in case this `onDidOpenTextDocument` call was
                // triggered by a changed language ID.
                this.updateVisibleTextEditors(window.visibleTextEditors)
                this.updateActiveTextEditor(window.activeTextEditor)
            }),
        )
        this.subscriptions.push(
            workspace.onDidCloseTextDocument(doc => {
                // Update visible and active editors in case this `onDidCloseTextDocument` call was
                // triggered by a changed language ID.
                this.updateVisibleTextEditors(window.visibleTextEditors)
                this.updateActiveTextEditor(window.activeTextEditor)
                this.updateLeanDocuments(workspace.textDocuments)
                this.closeLeanDocument(doc)
                this.invalidateClosedLastActiveLeanDocument(doc)
            }),
        )
        this.subscriptions.push(window.onDidChangeTextEditorSelection(event => this.updateTextEditorSelection(event)))
    }

    private updateVisibleTextEditors(visibleTextEditors: readonly TextEditor[]) {
        const oldVisibleLeanEditors = [...this._visibleLeanEditors]
        this.updateVisibleLeanEditors(visibleTextEditors)
        this.invalidateInvisibleLastActiveLeanEditor(visibleTextEditors)
        this.revealLeanEditors(oldVisibleLeanEditors, visibleTextEditors)
        this.concealLeanEditors(oldVisibleLeanEditors, visibleTextEditors)
    }

    private updateActiveTextEditor(activeTextEditor: TextEditor | undefined) {
        this.updateActiveLeanEditor(activeTextEditor)
        this.updateLastActiveLeanEditor(activeTextEditor)
        this.updateLastActiveLeanDocument(activeTextEditor)
    }

    private updateVisibleLeanEditors(visibleTextEditors: readonly TextEditor[]) {
        const newVisibleLeanEditors = filterLeanEditors(visibleTextEditors)
        if (
            newVisibleLeanEditors.length === this._visibleLeanEditors.length &&
            newVisibleLeanEditors.every((newVisibleLeanEditor, i) =>
                newVisibleLeanEditor.equals(this._visibleLeanEditors[i]),
            )
        ) {
            return
        }
        this._visibleLeanEditors = newVisibleLeanEditors
        this.visibleLeanEditorsByUri = new LeanEditorIndex(newVisibleLeanEditors)
        this.onDidChangeVisibleLeanEditorsEmitter.fire(newVisibleLeanEditors)
    }

    private revealLeanEditors(
        oldVisibleLeanEditors: readonly LeanEditor[],
        newVisibleTextEditors: readonly TextEditor[],
    ) {
        const oldVisibleLeanEditorsIndex = new Set(oldVisibleLeanEditors.map(leanEditor => leanEditor.editor))
        const newVisibleLeanEditors = filterLeanEditors(newVisibleTextEditors)
        const revealedLeanEditors = newVisibleLeanEditors.filter(
            newVisibleLeanEditor => !oldVisibleLeanEditorsIndex.has(newVisibleLeanEditor.editor),
        )
        for (const revealedLeanEditor of revealedLeanEditors) {
            this.onDidRevealLeanEditorEmitter.fire(revealedLeanEditor)
        }
    }

    private concealLeanEditors(
        oldVisibleLeanEditors: readonly LeanEditor[],
        newVisibleTextEditors: readonly TextEditor[],
    ) {
        const newVisibleLeanEditors = filterLeanEditors(newVisibleTextEditors)
        const newVisibleLeanEditorsIndex = new Set(newVisibleLeanEditors.map(leanEditor => leanEditor.editor))
        const concealedLeanEditors = oldVisibleLeanEditors.filter(
            newVisibleLeanEditor => !newVisibleLeanEditorsIndex.has(newVisibleLeanEditor.editor),
        )
        for (const concealedLeanEditor of concealedLeanEditors) {
            this.onDidConcealLeanEditorEmitter.fire(concealedLeanEditor)
        }
    }

    private updateActiveLeanEditor(activeTextEditor: TextEditor | undefined) {
        const newActiveLeanEditor = filterLeanEditor(activeTextEditor)
        if (LeanEditor.equalsWithUndefined(newActiveLeanEditor, this._activeLeanEditor)) {
            return
        }
        this._activeLeanEditor = newActiveLeanEditor
        this.onDidChangeActiveLeanEditorEmitter.fire(newActiveLeanEditor)
    }

    private invalidateInvisibleLastActiveLeanEditor(visibleTextEditors: readonly TextEditor[]) {
        if (
            this._lastActiveLeanEditor !== undefined &&
            !visibleTextEditors.includes(this._lastActiveLeanEditor.editor)
        ) {
            this._lastActiveLeanEditor = undefined
            this.onDidChangeLastActiveLeanEditorEmitter.fire(undefined)
        }
    }

    private updateLastActiveLeanEditor(activeTextEditor: TextEditor | undefined) {
        const newLastActiveLeanEditor = filterLeanEditor(activeTextEditor)
        if (newLastActiveLeanEditor === undefined) {
            return
        }
        if (LeanEditor.equalsWithUndefined(newLastActiveLeanEditor, this._lastActiveLeanEditor)) {
            return
        }
        this._lastActiveLeanEditor = newLastActiveLeanEditor
        this.onDidChangeLastActiveLeanEditorEmitter.fire(newLastActiveLeanEditor)
    }

    private updateLeanDocuments(textDocuments: readonly TextDocument[]) {
        const newLeanDocuments = filterLeanDocuments(textDocuments)
        if (
            newLeanDocuments.length === this._leanDocuments.length &&
            newLeanDocuments.every((newLeanDocument, i) => newLeanDocument.equals(this._leanDocuments[i]))
        ) {
            return
        }
        this._leanDocuments = newLeanDocuments
        this.leanDocumentsByUri = new LeanDocumentIndex(newLeanDocuments)
        this.onDidChangeLeanDocumentsEmitter.fire(newLeanDocuments)
    }

    private openLeanDocument(textDocument: TextDocument) {
        const leanTextDocument = filterLeanDocument(textDocument)
        if (leanTextDocument === undefined) {
            return
        }
        this.onDidOpenLeanDocumentEmitter.fire(leanTextDocument)
    }

    private closeLeanDocument(textDocument: TextDocument) {
        const leanTextDocument = filterLeanDocument(textDocument)
        if (leanTextDocument === undefined) {
            return
        }
        this.onDidCloseLeanDocumentEmitter.fire(leanTextDocument)
    }

    private invalidateClosedLastActiveLeanDocument(closedTextDocument: TextDocument) {
        if (this._lastActiveLeanDocument?.doc === closedTextDocument) {
            this._lastActiveLeanDocument = undefined
            this.onDidChangeLastActiveLeanDocumentEmitter.fire(undefined)
        }
    }

    private updateLastActiveLeanDocument(activeTextEditor: TextEditor | undefined) {
        const newLastActiveLeanDocument = filterLeanDocument(activeTextEditor?.document)
        if (newLastActiveLeanDocument === undefined) {
            return
        }
        if (LeanDocument.equalsWithUndefined(newLastActiveLeanDocument, this._lastActiveLeanDocument)) {
            return
        }
        this._lastActiveLeanDocument = newLastActiveLeanDocument
        this.onDidChangeLastActiveLeanDocumentEmitter.fire(newLastActiveLeanDocument)
    }

    private updateTextEditorSelection(event: TextEditorSelectionChangeEvent) {
        if (!isLeanEditor(event.textEditor)) {
            return
        }
        this.onDidChangeLeanEditorSelectionEmitter.fire(event)
    }

    get visibleLeanEditors(): readonly LeanEditor[] {
        return this._visibleLeanEditors
    }

    get activeLeanEditor(): LeanEditor | undefined {
        return this._activeLeanEditor
    }

    get lastActiveLeanEditor(): LeanEditor | undefined {
        return this._lastActiveLeanEditor
    }

    get leanDocuments(): readonly LeanDocument[] {
        return this._leanDocuments
    }

    get lastActiveLeanDocument(): LeanDocument | undefined {
        return this._lastActiveLeanDocument
    }

    getVisibleLeanEditorsByUri(uri: ExtUri): readonly LeanEditor[] {
        return this.visibleLeanEditorsByUri.get(uri) ?? []
    }

    getLeanDocumentByUri(uri: ExtUri): LeanDocument | undefined {
        return this.leanDocumentsByUri.get(uri)
    }

    registerLeanEditorCommand(
        command: string,
        callback: (leanEditor: LeanEditor, edit: TextEditorEdit, ...args: any[]) => void,
        thisArg?: any,
    ): Disposable {
        return commands.registerTextEditorCommand(
            command,
            (editor, edit, ...args) => {
                const leanEditor = filterLeanEditor(editor)
                if (leanEditor === undefined) {
                    return
                }
                callback(leanEditor, edit, ...args)
            },
            thisArg,
        )
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}

export let lean: LeanEditorProvider

/** Must be called at the very start when the extension is activated so that `lean` is defined. */
export function registerLeanEditorProvider(context: ExtensionContext) {
    lean = new LeanEditorProvider()
    context.subscriptions.push(lean)
    context.subscriptions.push({
        dispose: () => {
            const u: any = undefined
            // Implicit invariant: When the extension deactivates, `lean` is not called after this assignment.
            lean = u
        },
    })
}
