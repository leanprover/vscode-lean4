import { LeanFileProgressKind, LeanFileProgressProcessingInfo } from '@leanprover/infoview-api'
import assert from 'assert'
import {
    Range as CodeRange,
    DecorationOptions,
    Disposable,
    ExtensionContext,
    extensions,
    OverviewRulerLane,
    TextEditorDecorationType,
    window,
    workspace,
} from 'vscode'
import { Diagnostic, DiagnosticSeverity, Range as LspRange } from 'vscode-languageclient'
import { showDiagnosticGutterDecorations } from './config'
import { LeanClientProvider } from './utils/clientProvider'
import { ExtUri, parseExtUri } from './utils/exturi'
import { lean, LeanEditor } from './utils/leanEditorProvider'

interface DecorationState {
    type: TextEditorDecorationType
    prio: number
    decos: DecorationOptions[]
}

class LeanFileTaskGutter implements Disposable {
    private timeout: NodeJS.Timeout | undefined
    private decorationStates: DecorationState[] = []

    constructor(private uri: ExtUri) {}

    onDidReveal() {
        this.scheduleUpdate([], 100)
    }

    onDidUpdateState(newDecorationStates: DecorationState[]) {
        this.scheduleUpdate(newDecorationStates, 20)
    }

    clear(clearedDecorationTypes: TextEditorDecorationType[]) {
        const clearedDecorationStates = this.decorationStates
            .filter(
                state => clearedDecorationTypes.find(clearedType => clearedType.key === state.type.key) !== undefined,
            )
            .map(state => ({
                ...state,
                decos: [],
            }))
        this.scheduleUpdate(clearedDecorationStates, 100)
    }

    private scheduleUpdate(newDecorationStates: DecorationState[], ms: number) {
        for (const newState of newDecorationStates) {
            const idx = this.decorationStates.findIndex(oldState => oldState.type.key === newState.type.key)
            if (idx === -1) {
                this.decorationStates.push(newState)
            } else {
                this.decorationStates[idx] = newState
            }
        }
        this.decorationStates.sort((a, b) => a.prio - b.prio)
        if (this.timeout !== undefined) {
            return
        }
        this.timeout = setTimeout(() => {
            this.timeout = undefined
            for (const leanEditor of lean.getVisibleLeanEditorsByUri(this.uri)) {
                for (const state of this.decorationStates) {
                    leanEditor.editor.setDecorations(state.type, state.decos)
                }
            }
        }, ms)
    }

    dispose() {
        if (this.timeout !== undefined) {
            clearTimeout(this.timeout)
            this.timeout = undefined
        }
    }
}

type DiagStart =
    | 'None'
    | {
          kind: 'Error' | 'Warning'
          range: 'SingleLine' | 'MultiLine'
      }

function mergeDiagStarts(a: DiagStart, b: DiagStart): DiagStart {
    if (a === 'None') {
        return b
    }
    if (b === 'None') {
        return a
    }
    let kind: 'Error' | 'Warning'
    if (a.kind === 'Warning' && b.kind === 'Warning') {
        kind = 'Warning'
    } else {
        kind = 'Error'
    }
    let range: 'SingleLine' | 'MultiLine'
    if (a.range === 'SingleLine' && b.range === 'SingleLine') {
        range = 'SingleLine'
    } else {
        range = 'MultiLine'
    }
    return {
        kind,
        range,
    }
}

interface DiagnosticDeco {
    line: number
    diagStart: DiagStart
    isPreviousDiagContinue: boolean
    isPreviousDiagEnd: boolean
}

function mergeDiagnosticDecos(a: DiagnosticDeco, b: DiagnosticDeco): DiagnosticDeco {
    assert(a.line === b.line)
    const line = a.line
    const diagStart = mergeDiagStarts(a.diagStart, b.diagStart)
    const isPreviousDiagContinue = a.isPreviousDiagContinue || b.isPreviousDiagContinue
    const isPreviousDiagEnd = a.isPreviousDiagEnd || b.isPreviousDiagEnd
    return {
        line,
        diagStart,
        isPreviousDiagContinue,
        isPreviousDiagEnd,
    }
}

function determineDiagStart(d: Diagnostic, startLine: number, endLine: number, line: number): DiagStart {
    if (line !== startLine) {
        return 'None'
    }
    if (d.severity === DiagnosticSeverity.Error) {
        return {
            kind: 'Error',
            range: startLine === endLine ? 'SingleLine' : 'MultiLine',
        }
    } else if (d.severity === DiagnosticSeverity.Warning) {
        return {
            kind: 'Warning',
            range: 'SingleLine',
        }
    } else {
        throw new Error()
    }
}

function determineDiagnosticDeco(d: Diagnostic, startLine: number, endLine: number, line: number): DiagnosticDeco {
    const diagStart = determineDiagStart(d, startLine, endLine, line)
    if (diagStart !== 'None') {
        return {
            line,
            diagStart,
            isPreviousDiagContinue: false,
            isPreviousDiagEnd: false,
        }
    }
    return {
        line,
        diagStart,
        isPreviousDiagContinue: line < endLine,
        isPreviousDiagEnd: line === endLine,
    }
}

function computeDiagnosticDecos(diagnostics: Diagnostic[]): DiagnosticDeco[] {
    const decos: Map<number, DiagnosticDeco> = new Map()
    for (const d of diagnostics) {
        if (d.severity !== DiagnosticSeverity.Error && d.severity !== DiagnosticSeverity.Warning) {
            continue
        }
        const range = 'fullRange' in d ? (d.fullRange as LspRange) : d.range
        const startLine = range.start.line
        const endLine = range.end.line
        for (let line = startLine; line <= endLine; line++) {
            const deco = determineDiagnosticDeco(d, startLine, endLine, line)
            const oldDeco = decos.get(deco.line)
            if (oldDeco === undefined) {
                decos.set(deco.line, deco)
            } else {
                const mergedDeco = mergeDiagnosticDecos(oldDeco, deco)
                decos.set(deco.line, mergedDeco)
            }
        }
    }
    const result: DiagnosticDeco[] = [...decos.values()]
    result.sort((a, b) => a.line - b.line)
    return result
}

const diagnosticDecoKinds = [
    'error',
    'error-init',
    'error-i',
    'error-i-passthrough',
    'error-l',
    'error-l-passthrough',
    'error-t',
    'error-t-passthrough',
    'warning',
    'warning-i-passthrough',
    'warning-l-passthrough',
    'warning-t-passthrough',
] as const
type DiagnosticDecoKind = (typeof diagnosticDecoKinds)[number]

function determineDiagnosticDecoKind(d: DiagnosticDeco): DiagnosticDecoKind | undefined {
    const s = d.diagStart
    const c = d.isPreviousDiagContinue
    const e = d.isPreviousDiagEnd
    if (s !== 'None') {
        const k = s.kind
        const r = s.range
        if (k === 'Error') {
            if (!c && !e) {
                if (r === 'SingleLine') {
                    return 'error'
                }
                if (r === 'MultiLine') {
                    return 'error-init'
                }
                r satisfies never
            }
            if (!c && e) {
                if (r === 'SingleLine') {
                    return 'error-l-passthrough'
                }
                if (r === 'MultiLine') {
                    return 'error-t-passthrough'
                }
                r satisfies never
            }
            if (c && !e) {
                // All designs I can think of that would distinguish `SingleLine` and `MultiLine` in this case
                // have too much visual complexity for the small gutter.
                return 'error-i-passthrough'
            }
            if (c && e) {
                // All designs I can think of that would distinguish `SingleLine` and `MultiLine` in this case
                // have too much visual complexity for the small gutter.
                return 'error-t-passthrough'
            }
            assert(false)
        }
        if (k === 'Warning') {
            if (!c && !e) {
                return 'warning'
            }
            if (!c && e) {
                return 'warning-l-passthrough'
            }
            if (c && !e) {
                return 'warning-i-passthrough'
            }
            if (c && e) {
                return 'warning-t-passthrough'
            }
            assert(false)
        }
        k satisfies never
    }
    assert(s === 'None')
    if (!c && !e) {
        return undefined
    }
    if (!c && e) {
        return 'error-l'
    }
    if (c && !e) {
        return 'error-i'
    }
    if (c && e) {
        return 'error-t'
    }
    assert(false)
}

export class LeanTaskGutter implements Disposable {
    private processingDecorationType: TextEditorDecorationType
    private fatalErrorDecorationType: TextEditorDecorationType
    private diagnosticDecorationTypes: Map<DiagnosticDecoKind, TextEditorDecorationType> = new Map()

    private gutters: Map<string, LeanFileTaskGutter> = new Map()
    private subscriptions: Disposable[] = []
    private showDiagnosticGutterDecorations: boolean = true

    constructor(
        client: LeanClientProvider,
        private context: ExtensionContext,
    ) {
        this.processingDecorationType = window.createTextEditorDecorationType({
            overviewRulerLane: OverviewRulerLane.Left,
            overviewRulerColor: 'rgba(255, 165, 0, 0.5)',
            dark: {
                gutterIconPath: context.asAbsolutePath('media/progress-dark.svg'),
                gutterIconSize: 'contain',
            },
            light: {
                gutterIconPath: context.asAbsolutePath('media/progress-light.svg'),
                gutterIconSize: 'contain',
            },
        })
        this.fatalErrorDecorationType = window.createTextEditorDecorationType({
            overviewRulerLane: OverviewRulerLane.Left,
            overviewRulerColor: 'rgba(255, 0, 0, 0.5)',
            dark: {
                gutterIconPath: context.asAbsolutePath('media/progress-error-dark.svg'),
                gutterIconSize: 'contain',
            },
            light: {
                gutterIconPath: context.asAbsolutePath('media/progress-error-light.svg'),
                gutterIconSize: 'contain',
            },
        })
        for (const kind of diagnosticDecoKinds) {
            this.diagnosticDecorationTypes.set(
                kind,
                window.createTextEditorDecorationType({
                    dark: {
                        gutterIconPath: this.context.asAbsolutePath(`media/diagnostic-gutter-icons/${kind}-dark.svg`),
                        gutterIconSize: '100%',
                    },
                    light: {
                        gutterIconPath: this.context.asAbsolutePath(`media/diagnostic-gutter-icons/${kind}-light.svg`),
                        gutterIconSize: '100%',
                    },
                }),
            )
        }

        this.checkContext()

        this.subscriptions.push(
            this.processingDecorationType,
            this.fatalErrorDecorationType,
            lean.onDidCloseLeanDocument(doc => this.gutters.delete(doc.extUri.toString())),
            lean.onDidRevealLeanEditor(editor => this.onDidReveal(editor)),
            window.onDidChangeActiveColorTheme(() => this.onDidChangeColorTheme()),
            extensions.onDidChange(() => this.checkContext()),
            workspace.onDidChangeConfiguration(() => this.checkContext()),
            client.progressChanged(([uri, processingInfos]) => {
                const extUri = parseExtUri(uri)
                if (extUri === undefined) {
                    return
                }
                this.onProgressChanged(extUri, processingInfos)
            }),
            client.diagnosticsChanged(params => {
                const extUri = parseExtUri(params.uri)
                if (extUri === undefined) {
                    return
                }
                this.onDiagnosticsChanged(extUri, params.diagnostics)
            }),
        )
    }

    private checkContext() {
        // Use the error lens gutter for diagnostics if it is enabled.
        const errorLensExtensions = extensions.getExtension('usernamehw.errorlens')
        const isErrorLensGutterEnabled =
            errorLensExtensions !== undefined &&
            errorLensExtensions.isActive &&
            workspace.getConfiguration('errorLens').get('gutterIconsEnabled', false)
        this.showDiagnosticGutterDecorations = !isErrorLensGutterEnabled && showDiagnosticGutterDecorations()
        if (!this.showDiagnosticGutterDecorations) {
            for (const gutter of this.gutters.values()) {
                gutter.clear([...this.diagnosticDecorationTypes.values()])
            }
        }
    }

    private getGutter(uri: ExtUri): LeanFileTaskGutter {
        const uriKey = uri.toString()
        if (!this.gutters.has(uriKey)) {
            const newGutter = new LeanFileTaskGutter(uri)
            this.gutters.set(uriKey, newGutter)
            return newGutter
        }
        return this.gutters.get(uriKey)!
    }

    private onDidChangeColorTheme() {
        for (const leanEditor of lean.visibleLeanEditors) {
            this.getGutter(leanEditor.documentExtUri).onDidReveal()
        }
    }

    private onDidReveal(leanEditor: LeanEditor) {
        this.getGutter(leanEditor.documentExtUri).onDidReveal()
    }

    private onProgressChanged(uri: ExtUri, processingInfos: LeanFileProgressProcessingInfo[]) {
        const processingState: DecorationState = {
            type: this.processingDecorationType,
            prio: 0,
            decos: processingInfos
                .filter(i => i.kind === undefined || i.kind === LeanFileProgressKind.Processing)
                .map(i => ({
                    range: new CodeRange(i.range.start.line, 0, i.range.end.line, 0),
                    hoverMessage: 'Processing ...',
                })),
        }
        const fatalErrorState: DecorationState = {
            type: this.fatalErrorDecorationType,
            prio: 0,
            decos: processingInfos
                .filter(i => i.kind === LeanFileProgressKind.FatalError)
                .map(i => ({
                    range: new CodeRange(i.range.start.line, 0, i.range.end.line, 0),
                    hoverMessage: 'Processing stopped',
                })),
        }
        this.getGutter(uri).onDidUpdateState([processingState, fatalErrorState])
    }

    private onDiagnosticsChanged(uri: ExtUri, diagnostics: Diagnostic[]) {
        if (!this.showDiagnosticGutterDecorations) {
            return
        }
        const decoStates = this.computeDiagnosticDecoStates(diagnostics)
        this.getGutter(uri).onDidUpdateState(decoStates)
    }

    private computeDiagnosticDecoStates(diagnostics: Diagnostic[]): DecorationState[] {
        const decoStates: Map<DiagnosticDecoKind, DecorationState> = new Map()
        for (const [kind, type] of this.diagnosticDecorationTypes.entries()) {
            decoStates.set(kind, {
                type,
                prio: 1,
                decos: [],
            })
        }
        const decos = computeDiagnosticDecos(diagnostics)
        for (const deco of decos) {
            const kind = determineDiagnosticDecoKind(deco)
            if (kind === undefined) {
                continue
            }
            decoStates.get(kind)!.decos.push({
                range: new CodeRange(deco.line, 0, deco.line, 0),
            })
        }
        return [...decoStates.values()]
    }

    dispose(): void {
        for (const gutter of this.gutters.values()) {
            gutter.dispose()
        }
        for (const t of this.diagnosticDecorationTypes.values()) {
            t.dispose()
        }
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
