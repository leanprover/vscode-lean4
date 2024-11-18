import { Disposable, EventEmitter, ExtensionContext, TextDocument, TextEditor, Uri, window, workspace } from 'vscode'
import { ExtUri, isExtUri } from './exturi'

function groupByKey<K, V>(values: V[], key: (value: V) => K): Map<K, V[]> {
    const r = new Map<K, V[]>()
    for (const v of values) {
        const k = key(v)
        const group = r.get(k) ?? []
        group.push(v)
        r.set(k, group)
    }
    return r
}

function groupByUniqueKey<K, V>(values: V[], key: (value: V) => K): Map<K, V> {
    const r = new Map<K, V>()
    for (const v of values) {
        r.set(key(v), v)
    }
    return r
}

class TextDocumentIndex {
    private docsByUri: Map<string, TextDocument>

    /**
     * Assumes that `docs` only contains at most one `TextDocument` per URI.
     * This is given for `TextDocument`s from VS Code.
     * */
    constructor(docs: TextDocument[]) {
        this.docsByUri = groupByUniqueKey(docs, doc => doc.uri.toString())
    }

    get(uri: Uri): TextDocument | undefined {
        return this.docsByUri.get(uri.toString())
    }
}

class TextEditorIndex {
    private editorsByUri: Map<string, TextEditor[]>

    constructor(editors: TextEditor[]) {
        this.editorsByUri = groupByKey(editors, editor => editor.document.uri.toString())
    }

    get(uri: Uri): TextEditor[] | undefined {
        return this.editorsByUri.get(uri.toString())
    }
}

export function isLeanDocument(doc: TextDocument): boolean {
    return isExtUri(doc.uri) && doc.languageId === 'lean4'
}

export function filterLeanDocuments(docs: readonly TextDocument[]): TextDocument[] {
    return docs.filter(doc => isLeanDocument(doc))
}

export function filterLeanDocument(doc: TextDocument | undefined): TextDocument | undefined {
    if (doc !== undefined && isLeanDocument(doc)) {
        return doc
    }
    return undefined
}

export function isLeanEditor(editor: TextEditor): boolean {
    return isLeanDocument(editor.document)
}

export function filterLeanEditors(editors: readonly TextEditor[]): TextEditor[] {
    return editors.filter(editor => isLeanEditor(editor))
}

export function filterLeanEditor(editor: TextEditor | undefined): TextEditor | undefined {
    if (editor !== undefined && isLeanEditor(editor)) {
        return editor
    }
    return undefined
}

export class LeanEditorProvider implements Disposable {
    private subscriptions: Disposable[] = []

    private _visibleLeanEditors: TextEditor[]
    private visibleLeanEditorsByUri: TextEditorIndex
    private readonly onDidChangeVisibleLeanEditorsEmitter = new EventEmitter<readonly TextEditor[]>()
    readonly onDidChangeVisibleLeanEditors = this.onDidChangeVisibleLeanEditorsEmitter.event

    private _activeLeanEditor: TextEditor | undefined
    private readonly onDidChangeActiveLeanEditorEmitter = new EventEmitter<TextEditor | undefined>()
    readonly onDidChangeActiveLeanEditor = this.onDidChangeActiveLeanEditorEmitter.event

    private _lastActiveLeanEditor: TextEditor | undefined
    private readonly onDidChangeLastActiveLeanEditorEmitter = new EventEmitter<TextEditor | undefined>()
    readonly onDidChangeLastActiveLeanEditor = this.onDidChangeLastActiveLeanEditorEmitter.event

    private _leanDocuments: TextDocument[]
    private leanDocumentsByUri: TextDocumentIndex
    private readonly onDidChangeLeanDocumentsEmitter = new EventEmitter<readonly TextDocument[]>()
    readonly onDidChangeLeanDocuments = this.onDidChangeLeanDocumentsEmitter.event
    private readonly onDidOpenLeanDocumentEmitter = new EventEmitter<TextDocument>()
    readonly onDidOpenLeanDocument = this.onDidOpenLeanDocumentEmitter.event
    private readonly onDidCloseLeanDocumentEmitter = new EventEmitter<TextDocument>()
    readonly onDidCloseLeanDocument = this.onDidCloseLeanDocumentEmitter.event

    private _lastActiveLeanDocument: TextDocument | undefined
    private readonly onDidChangeLastActiveLeanDocumentEmitter = new EventEmitter<TextDocument | undefined>()
    readonly onDidChangeLastActiveLeanDocument = this.onDidChangeLastActiveLeanDocumentEmitter.event

    private readonly onDidRevealLeanEditorEmitter = new EventEmitter<TextEditor>()
    readonly onDidRevealLeanEditor = this.onDidRevealLeanEditorEmitter.event
    private readonly onDidConcealLeanEditorEmitter = new EventEmitter<TextEditor>()
    readonly onDidConcealLeanEditor = this.onDidConcealLeanEditorEmitter.event

    constructor() {
        this._visibleLeanEditors = filterLeanEditors(window.visibleTextEditors)
        this.visibleLeanEditorsByUri = new TextEditorIndex(this._visibleLeanEditors)
        this.subscriptions.push(window.onDidChangeVisibleTextEditors(editors => this.updateVisibleTextEditors(editors)))

        this._activeLeanEditor = filterLeanEditor(window.activeTextEditor)
        this.subscriptions.push(window.onDidChangeActiveTextEditor(editor => this.updateActiveTextEditor(editor)))

        this._leanDocuments = filterLeanDocuments(workspace.textDocuments)
        this.leanDocumentsByUri = new TextDocumentIndex(this._leanDocuments)
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
                this.updateLeanDocuments(workspace.textDocuments)
                this.closeLeanDocument(doc)
                this.invalidateClosedLastActiveLeanDocument(doc)
                // Update visible and active editors in case this `onDidCloseTextDocument` call was
                // triggered by a changed language ID.
                this.updateVisibleTextEditors(window.visibleTextEditors)
                this.updateActiveTextEditor(window.activeTextEditor)
            }),
        )
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
            newVisibleLeanEditors.every(
                (newVisibleLeanEditor, i) => newVisibleLeanEditor === this._visibleLeanEditors[i],
            )
        ) {
            return
        }
        this._visibleLeanEditors = newVisibleLeanEditors
        this.visibleLeanEditorsByUri = new TextEditorIndex(newVisibleLeanEditors)
        this.onDidChangeVisibleLeanEditorsEmitter.fire(newVisibleLeanEditors)
    }

    private revealLeanEditors(
        oldVisibleLeanEditors: readonly TextEditor[],
        newVisibleTextEditors: readonly TextEditor[],
    ) {
        const oldVisibleLeanEditorsIndex = new Set(oldVisibleLeanEditors)
        const newVisibleLeanEditors = filterLeanEditors(newVisibleTextEditors)
        const revealedLeanEditors = newVisibleLeanEditors.filter(
            newVisibleLeanEditor => !oldVisibleLeanEditorsIndex.has(newVisibleLeanEditor),
        )
        for (const revealedLeanEditor of revealedLeanEditors) {
            this.onDidRevealLeanEditorEmitter.fire(revealedLeanEditor)
        }
    }

    private concealLeanEditors(
        oldVisibleLeanEditors: readonly TextEditor[],
        newVisibleTextEditors: readonly TextEditor[],
    ) {
        const newVisibleLeanEditors = filterLeanEditors(newVisibleTextEditors)
        const newVisibleLeanEditorsIndex = new Set(newVisibleLeanEditors)
        const concealedLeanEditors = oldVisibleLeanEditors.filter(
            newVisibleLeanEditor => !newVisibleLeanEditorsIndex.has(newVisibleLeanEditor),
        )
        for (const concealedLeanEditor of concealedLeanEditors) {
            this.onDidConcealLeanEditorEmitter.fire(concealedLeanEditor)
        }
    }

    private updateActiveLeanEditor(activeTextEditor: TextEditor | undefined) {
        const newActiveLeanEditor = filterLeanEditor(activeTextEditor)
        if (newActiveLeanEditor === this._activeLeanEditor) {
            return
        }
        this._activeLeanEditor = newActiveLeanEditor
        this.onDidChangeActiveLeanEditorEmitter.fire(newActiveLeanEditor)
    }

    private invalidateInvisibleLastActiveLeanEditor(visibleTextEditors: readonly TextEditor[]) {
        if (this._lastActiveLeanEditor !== undefined && !visibleTextEditors.includes(this._lastActiveLeanEditor)) {
            this._lastActiveLeanEditor = undefined
            this.onDidChangeLastActiveLeanEditorEmitter.fire(undefined)
        }
    }

    private updateLastActiveLeanEditor(activeTextEditor: TextEditor | undefined) {
        const newLastActiveLeanEditor = filterLeanEditor(activeTextEditor)
        if (newLastActiveLeanEditor === undefined) {
            return
        }
        if (newLastActiveLeanEditor === this._lastActiveLeanEditor) {
            return
        }
        this._lastActiveLeanEditor = newLastActiveLeanEditor
        this.onDidChangeLastActiveLeanEditorEmitter.fire(newLastActiveLeanEditor)
    }

    private updateLeanDocuments(textDocuments: readonly TextDocument[]) {
        const newLeanDocuments = filterLeanDocuments(textDocuments)
        if (
            newLeanDocuments.length === this._leanDocuments.length &&
            newLeanDocuments.every((newLeanDocument, i) => newLeanDocument === this._leanDocuments[i])
        ) {
            return
        }
        this._leanDocuments = newLeanDocuments
        this.leanDocumentsByUri = new TextDocumentIndex(newLeanDocuments)
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
        if (this._lastActiveLeanDocument === closedTextDocument) {
            this._lastActiveLeanDocument = undefined
            this.onDidChangeLastActiveLeanDocumentEmitter.fire(undefined)
        }
    }

    private updateLastActiveLeanDocument(activeTextEditor: TextEditor | undefined) {
        const newLastActiveLeanDocument = filterLeanDocument(activeTextEditor?.document)
        if (newLastActiveLeanDocument === undefined) {
            return
        }
        if (newLastActiveLeanDocument === this._lastActiveLeanDocument) {
            return
        }
        this._lastActiveLeanDocument = newLastActiveLeanDocument
        this.onDidChangeLastActiveLeanDocumentEmitter.fire(newLastActiveLeanDocument)
    }

    get visibleLeanEditors(): readonly TextEditor[] {
        return this._visibleLeanEditors
    }

    get activeLeanEditor(): TextEditor | undefined {
        return this._activeLeanEditor
    }

    get lastActiveLeanEditor(): TextEditor | undefined {
        return this._lastActiveLeanEditor
    }

    get leanDocuments(): readonly TextDocument[] {
        return this._leanDocuments
    }

    get lastActiveLeanDocument(): TextDocument | undefined {
        return this._lastActiveLeanDocument
    }

    getVisibleLeanEditorsByUri(uri: ExtUri): readonly TextEditor[] | undefined {
        return this.visibleLeanEditorsByUri.get(uri.asUri())
    }

    getLeanDocumentByUri(uri: ExtUri): TextDocument | undefined {
        return this.leanDocumentsByUri.get(uri.asUri())
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}

export let leanEditor: LeanEditorProvider

/** Must be called at the very start when the extension is activated so that `leanEditor` is defined. */
export function registerLeanEditor(context: ExtensionContext) {
    leanEditor = new LeanEditorProvider()
    context.subscriptions.push(leanEditor)
}
