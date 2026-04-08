import { DiagnosticCollection, Disposable, EventEmitter } from 'vscode'
import { LeanDiagnostic, LeanPublishDiagnosticsParams, p2cConverter } from './utils/converters'
import { DocumentUri } from 'vscode-languageserver-protocol'

export type DiagnosticChangeKind = 'replace' | 'append'

export class DiagnosticChangeEvent {
    readonly kind: DiagnosticChangeKind
    readonly params: LeanPublishDiagnosticsParams
    private readonly accumulated: LeanDiagnostic[]
    private readonly amountAccumulated: number

    constructor(kind: DiagnosticChangeKind, params: LeanPublishDiagnosticsParams, accumulated: LeanDiagnostic[]) {
        this.kind = kind
        this.params = params
        this.accumulated = accumulated
        this.amountAccumulated = accumulated.length
    }

    private accumulatedDiagnostics(): LeanDiagnostic[] {
        return this.accumulated.slice(0, this.amountAccumulated)
    }

    accumulatedParams(): LeanPublishDiagnosticsParams {
        return { ...this.params, diagnostics: this.accumulatedDiagnostics() }
    }
}

export class LeanClientDiagnosticCollection implements Disposable {
    readonly vsCodeCollection: DiagnosticCollection
    private diags: Map<DocumentUri, LeanPublishDiagnosticsParams> = new Map()

    private diagnosticsChangedEmitter = new EventEmitter<DiagnosticChangeEvent>()
    onDidChangeDiagnostics = this.diagnosticsChangedEmitter.event

    constructor(vsCodeCollection: DiagnosticCollection) {
        this.vsCodeCollection = vsCodeCollection
    }

    private static determineChangeKind(
        prev: LeanPublishDiagnosticsParams | undefined,
        next: LeanPublishDiagnosticsParams,
    ): DiagnosticChangeKind {
        if (prev === undefined) {
            return 'replace'
        }
        if (!next.isIncremental) {
            return 'replace'
        }
        return 'append'
    }

    publishDiagnostics(params: LeanPublishDiagnosticsParams): void {
        const prev = this.diags.get(params.uri)
        const kind = LeanClientDiagnosticCollection.determineChangeKind(prev, params)

        let accumulated: LeanDiagnostic[]
        if (kind === 'append') {
            accumulated = prev!.diagnostics
            accumulated.push(...params.diagnostics)
        } else {
            accumulated = [...params.diagnostics]
        }

        const accumulatedParams = { ...params, diagnostics: accumulated }

        this.diags.set(accumulatedParams.uri, accumulatedParams)
        void this.syncToCollection(accumulatedParams)
        this.diagnosticsChangedEmitter.fire(new DiagnosticChangeEvent(kind, params, accumulated))
    }

    private async syncToCollection(p: LeanPublishDiagnosticsParams): Promise<void> {
        const nonSilent = p.diagnostics.filter(d => !d.isSilent)
        const uri = p2cConverter.asUri(p.uri)
        const vsCodeDiags = await p2cConverter.asDiagnostics(nonSilent)
        this.vsCodeCollection.set(uri, vsCodeDiags)
    }

    dispose(): void {
        this.diagnosticsChangedEmitter.dispose()
    }
}
