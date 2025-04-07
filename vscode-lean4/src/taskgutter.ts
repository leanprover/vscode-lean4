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
import { DiagnosticSeverity, Range as LspRange } from 'vscode-languageclient'
import {
    decorationEditDelay,
    goalsAccomplishedDecorationKind,
    showDiagnosticGutterDecorations,
    showUnsolvedGoalsDecoration,
    unsolvedGoalsDecorationDarkThemeColor,
    unsolvedGoalsDecorationLightThemeColor,
} from './config'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanDiagnostic, LeanTag } from './utils/converters'
import { ExtUri, parseExtUri } from './utils/exturi'
import { lean, LeanEditor } from './utils/leanEditorProvider'

type DecorationStateKind = 'EditDelayed' | 'Instantaneous'

interface DecorationState {
    type: TextEditorDecorationType
    prio: number
    kind: DecorationStateKind
    decos: DecorationOptions[]
}

class LeanFileTaskGutter implements Disposable {
    private readonly editDelayMs: number = decorationEditDelay()
    private timeout: NodeJS.Timeout | undefined
    private editDelayTimeout: NodeJS.Timeout | undefined
    private lastEditTimestampMs: number | undefined
    private subscriptions: Disposable[] = []
    private decorationStates: DecorationState[] = []

    constructor(private uri: ExtUri) {
        workspace.onDidChangeTextDocument(e => {
            if (!uri.equalsUri(e.document.uri)) {
                return
            }
            this.onDidChange()
        }, this.subscriptions)
    }

    private onDidChange() {
        clearTimeout(this.editDelayTimeout)
        this.lastEditTimestampMs = Date.now()
    }

    onDidReveal() {
        this.scheduleUpdate([], 100)
    }

    onDidUpdateState(newDecorationStates: DecorationState[]) {
        this.scheduleUpdate(newDecorationStates, 100)
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
        this.updateDecorationStates(newDecorationStates)
        if (this.timeout === undefined) {
            this.timeout = setTimeout(() => {
                this.timeout = undefined
                this.displayDecorations('Instantaneous')
            }, ms)
        }
        clearTimeout(this.editDelayTimeout)
        const remainingDelayMs =
            this.lastEditTimestampMs !== undefined
                ? Math.max(ms, this.editDelayMs - (Date.now() - this.lastEditTimestampMs))
                : ms
        this.editDelayTimeout = setTimeout(() => {
            this.editDelayTimeout = undefined
            this.displayDecorations('EditDelayed')
        }, remainingDelayMs)
    }

    private updateDecorationStates(newDecorationStates: DecorationState[]) {
        for (const newState of newDecorationStates) {
            const idx = this.decorationStates.findIndex(oldState => oldState.type.key === newState.type.key)
            if (idx === -1) {
                this.decorationStates.push(newState)
            } else {
                this.decorationStates[idx] = newState
            }
        }
        this.decorationStates.sort((a, b) => a.prio - b.prio)
    }

    private displayDecorations(kind: DecorationStateKind) {
        for (const leanEditor of lean.getVisibleLeanEditorsByUri(this.uri)) {
            for (const state of this.decorationStates) {
                if (state.kind === kind) {
                    leanEditor.editor.setDecorations(state.type, state.decos)
                }
            }
        }
    }

    dispose() {
        clearTimeout(this.timeout)
        clearTimeout(this.editDelayTimeout)
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}

function diagRange(d: LeanDiagnostic): LspRange {
    if (d.severity !== DiagnosticSeverity.Error) {
        return d.range
    }
    if (d.fullRange === undefined) {
        return d.range
    }
    return d.fullRange
}

function inclusiveEndLine(r: LspRange): number {
    if (r.start.line === r.end.line) {
        return r.end.line
    }
    if (r.end.character === 0) {
        return r.end.line - 1
    }
    return r.end.line
}

function diagStartKindPrio(kind: 'Error' | 'Warning' | 'GoalsAccomplished'): number {
    switch (kind) {
        case 'Error':
            return 2
        case 'Warning':
            return 1
        case 'GoalsAccomplished':
            return 0
    }
}

function diagStartRangePrio(range: 'SingleLine' | 'MultiLine'): number {
    switch (range) {
        case 'SingleLine':
            return 0
        case 'MultiLine':
            return 1
    }
}

type DiagStart =
    | 'None'
    | {
          kind: 'Error' | 'Warning' | 'GoalsAccomplished'
          range: 'SingleLine' | 'MultiLine'
      }

function mergeDiagStarts(a: DiagStart, b: DiagStart): DiagStart {
    if (a === 'None') {
        return b
    }
    if (b === 'None') {
        return a
    }
    const kind: 'Error' | 'Warning' | 'GoalsAccomplished' =
        diagStartKindPrio(a.kind) >= diagStartKindPrio(b.kind) ? a.kind : b.kind
    const range: 'SingleLine' | 'MultiLine' =
        diagStartRangePrio(a.range) >= diagStartRangePrio(b.range) ? a.range : b.range
    return {
        kind,
        range,
    }
}

interface DiagnosticGutterDeco {
    line: number
    diagStart: DiagStart
    isPreviousDiagContinue: boolean
    isPreviousDiagEnd: boolean
}

function mergeDiagnosticGutterDecos(a: DiagnosticGutterDeco, b: DiagnosticGutterDeco): DiagnosticGutterDeco {
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

function isGoalsAccomplishedDiagnostic(d: LeanDiagnostic): boolean {
    return d.leanTags !== undefined && d.leanTags.some(t => t === LeanTag.GoalsAccomplished)
}

function determineDiagStart(d: LeanDiagnostic, startLine: number, endLine: number, line: number): DiagStart {
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
    } else if (isGoalsAccomplishedDiagnostic(d)) {
        return {
            kind: 'GoalsAccomplished',
            range: 'SingleLine',
        }
    } else {
        throw new Error()
    }
}

function determineDiagnosticGutterDeco(
    d: LeanDiagnostic,
    startLine: number,
    endLine: number,
    line: number,
): DiagnosticGutterDeco {
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

function updateDecos(decos: Map<number, DiagnosticGutterDeco>, deco: DiagnosticGutterDeco) {
    const oldDeco = decos.get(deco.line)
    if (oldDeco === undefined) {
        decos.set(deco.line, deco)
    } else {
        const mergedDeco = mergeDiagnosticGutterDecos(oldDeco, deco)
        decos.set(deco.line, mergedDeco)
    }
}

const diagnosticGutterDecoKinds = [
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
    'goals-accomplished-checkmark',
    'goals-accomplished-checkmark-i-passthrough',
    'goals-accomplished-checkmark-l-passthrough',
    'goals-accomplished-checkmark-t-passthrough',
    'goals-accomplished-circled-checkmark',
    'goals-accomplished-circled-checkmark-i-passthrough',
    'goals-accomplished-circled-checkmark-l-passthrough',
    'goals-accomplished-circled-checkmark-t-passthrough',
    'goals-accomplished-octopus',
    'goals-accomplished-octopus-i-passthrough',
    'goals-accomplished-octopus-l-passthrough',
    'goals-accomplished-octopus-t-passthrough',
    'goals-accomplished-tada',
    'goals-accomplished-tada-i-passthrough',
    'goals-accomplished-tada-l-passthrough',
    'goals-accomplished-tada-t-passthrough',
] as const
type DiagnosticGutterDecoKind = (typeof diagnosticGutterDecoKinds)[number]

export class LeanTaskGutter implements Disposable {
    private processingDecorationType: TextEditorDecorationType
    private fatalErrorDecorationType: TextEditorDecorationType
    private unsolvedGoalsDecorationType: TextEditorDecorationType
    private diagnosticGutterDecorationTypes: Map<DiagnosticGutterDecoKind, TextEditorDecorationType> = new Map()

    private gutters: Map<string, LeanFileTaskGutter> = new Map()
    private subscriptions: Disposable[] = []
    private showDiagnosticGutterDecorations: boolean = true
    private goalsAccomplishedDecorationKind: string
    private showUnsolvedGoalsDecoration: boolean = true

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
        this.unsolvedGoalsDecorationType = window.createTextEditorDecorationType({
            dark: {
                after: {
                    contentText: '🛠',
                    color: unsolvedGoalsDecorationDarkThemeColor(),
                    margin: '0 0 0 1ch',
                },
            },
            light: {
                after: {
                    contentText: '🛠',
                    color: unsolvedGoalsDecorationLightThemeColor(),
                    margin: '0 0 0 1ch',
                },
            },
            isWholeLine: true,
        })
        for (const kind of diagnosticGutterDecoKinds) {
            this.diagnosticGutterDecorationTypes.set(
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
            this.unsolvedGoalsDecorationType,
            lean.onDidCloseLeanDocument(doc => {
                const uri = doc.extUri.toString()
                this.gutters.get(uri)?.dispose()
                this.gutters.delete(uri)
            }),
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
        this.goalsAccomplishedDecorationKind = goalsAccomplishedDecorationKind()
        this.showUnsolvedGoalsDecoration = showUnsolvedGoalsDecoration()
        if (!this.showDiagnosticGutterDecorations) {
            for (const gutter of this.gutters.values()) {
                gutter.clear([...this.diagnosticGutterDecorationTypes.values()])
            }
        }
        if (!this.showUnsolvedGoalsDecoration) {
            for (const gutter of this.gutters.values()) {
                gutter.clear([this.unsolvedGoalsDecorationType])
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
            prio: 1,
            kind: 'Instantaneous',
            decos: processingInfos
                .filter(i => i.kind === undefined || i.kind === LeanFileProgressKind.Processing)
                .map(i => ({
                    range: new CodeRange(i.range.start.line, 0, i.range.end.line, 0),
                    hoverMessage: 'Processing ...',
                })),
        }
        const fatalErrorState: DecorationState = {
            type: this.fatalErrorDecorationType,
            prio: 1,
            kind: 'Instantaneous',
            decos: processingInfos
                .filter(i => i.kind === LeanFileProgressKind.FatalError)
                .map(i => ({
                    range: new CodeRange(i.range.start.line, 0, i.range.end.line, 0),
                    hoverMessage: 'Processing stopped',
                })),
        }
        this.getGutter(uri).onDidUpdateState([processingState, fatalErrorState])
    }

    private onDiagnosticsChanged(uri: ExtUri, diagnostics: LeanDiagnostic[]) {
        const decoStates: DecorationState[] = []
        if (this.showDiagnosticGutterDecorations) {
            decoStates.push(...this.computeDiagnosticGutterDecoStates(diagnostics))
        }
        if (this.showUnsolvedGoalsDecoration) {
            decoStates.push(this.computeUnsolvedGoalsDecoState(diagnostics))
        }
        this.getGutter(uri).onDidUpdateState(decoStates)
    }

    private computeDiagnosticGutterDecoStates(diagnostics: LeanDiagnostic[]): DecorationState[] {
        const decoStates: Map<DiagnosticGutterDecoKind, DecorationState> = new Map()
        for (const [kind, type] of this.diagnosticGutterDecorationTypes.entries()) {
            decoStates.set(kind, {
                type,
                prio: 0,
                kind: 'Instantaneous',
                decos: [],
            })
        }
        const decos = this.computeDiagnosticGutterDecos(diagnostics)
        for (const deco of decos) {
            const kind = this.determineDiagnosticGutterDecoKind(deco)
            if (kind === undefined) {
                continue
            }
            decoStates.get(kind)!.decos.push({
                range: new CodeRange(deco.line, 0, deco.line, 0),
            })
        }
        return [...decoStates.values()]
    }

    computeDiagnosticGutterDecos(diagnostics: LeanDiagnostic[]): DiagnosticGutterDeco[] {
        const decos: Map<number, DiagnosticGutterDeco> = new Map()
        for (const d of diagnostics) {
            if (!this.isGutterDecoDiagnostic(d)) {
                continue
            }
            const range = diagRange(d)
            const startLine = range.start.line
            const endLine = inclusiveEndLine(range)
            const startDeco = determineDiagnosticGutterDeco(d, startLine, endLine, startLine)
            updateDecos(decos, startDeco)
            if (startDeco.diagStart !== 'None' && startDeco.diagStart.range === 'SingleLine') {
                continue
            }
            for (let line = startLine + 1; line <= endLine; line++) {
                const deco = determineDiagnosticGutterDeco(d, startLine, endLine, line)
                updateDecos(decos, deco)
            }
        }
        const result: DiagnosticGutterDeco[] = [...decos.values()]
        result.sort((a, b) => a.line - b.line)
        return result
    }

    isGutterDecoDiagnostic(d: LeanDiagnostic): boolean {
        return (
            d.severity === DiagnosticSeverity.Error ||
            d.severity === DiagnosticSeverity.Warning ||
            (isGoalsAccomplishedDiagnostic(d) && this.goalsAccomplishedDecorationKind !== 'Off')
        )
    }

    getGoalsAccomplishedDiagnosticGutterDecoKindName(): string {
        const configName = this.goalsAccomplishedDecorationKind
        if (configName === 'Double Checkmark') {
            return 'goals-accomplished-checkmark'
        }
        if (configName === 'Circled Checkmark') {
            return 'goals-accomplished-circled-checkmark'
        }
        if (configName === 'Octopus') {
            return 'goals-accomplished-octopus'
        }
        if (configName === 'Tada') {
            return 'goals-accomplished-tada'
        }
        return 'goals-accomplished-checkmark'
    }

    determineSingleLineDiagnosticGutterDecoKind(d: DiagnosticGutterDeco, name: string): DiagnosticGutterDecoKind {
        const c = d.isPreviousDiagContinue
        const e = d.isPreviousDiagEnd
        if (!c && !e) {
            return name as DiagnosticGutterDecoKind
        }
        if (!c && e) {
            return `${name}-l-passthrough` as DiagnosticGutterDecoKind
        }
        if (c && !e) {
            return `${name}-i-passthrough` as DiagnosticGutterDecoKind
        }
        if (c && e) {
            return `${name}-t-passthrough` as DiagnosticGutterDecoKind
        }
        assert(false)
    }

    determineDiagnosticGutterDecoKind(d: DiagnosticGutterDeco): DiagnosticGutterDecoKind | undefined {
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
                return this.determineSingleLineDiagnosticGutterDecoKind(d, 'warning')
            }
            if (k === 'GoalsAccomplished') {
                return this.determineSingleLineDiagnosticGutterDecoKind(
                    d,
                    this.getGoalsAccomplishedDiagnosticGutterDecoKindName(),
                )
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

    private computeUnsolvedGoalsDecoState(diagnostics: LeanDiagnostic[]): DecorationState {
        const unsolvedGoalsLines = diagnostics
            .filter(d => {
                return d.leanTags?.some(t => t === LeanTag.UnsolvedGoals)
            })
            .map(d => {
                const range = diagRange(d)
                return inclusiveEndLine(range)
            })
        return {
            type: this.unsolvedGoalsDecorationType,
            prio: 0,
            kind: 'EditDelayed',
            decos: unsolvedGoalsLines.map(line => ({
                range: new CodeRange(line, 0, line, 0),
            })),
        }
    }

    dispose(): void {
        for (const gutter of this.gutters.values()) {
            gutter.dispose()
        }
        for (const t of this.diagnosticGutterDecorationTypes.values()) {
            t.dispose()
        }
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
