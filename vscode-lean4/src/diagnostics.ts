import { CancellationToken, DiagnosticCollection, Disposable, EventEmitter } from 'vscode'
import { DocumentUri } from 'vscode-languageserver-protocol'
import { CoalescingSyncQueue } from './utils/coalescingSyncQueue'
import { LeanDiagnostic, LeanPublishDiagnosticsParams, p2cConverter } from './utils/converters'

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

type SyncQueueEntry = {
    accumulatedParams: LeanPublishDiagnosticsParams
    pendingKind: DiagnosticChangeKind
    pendingBatch: LeanDiagnostic[]
}

function combineEntries(existing: SyncQueueEntry, incoming: SyncQueueEntry): SyncQueueEntry {
    if (incoming.pendingKind === 'replace') {
        return incoming
    }
    incoming.pendingKind satisfies 'append'
    return {
        accumulatedParams: incoming.accumulatedParams,
        pendingKind: existing.pendingKind,
        pendingBatch: [...existing.pendingBatch, ...incoming.pendingBatch],
    }
}

export class LeanClientDiagnosticCollection implements Disposable {
    readonly vsCodeCollection: DiagnosticCollection
    private diags: Map<DocumentUri, LeanPublishDiagnosticsParams> = new Map()

    private diagnosticsChangedEmitter = new EventEmitter<DiagnosticChangeEvent>()
    onDidChangeDiagnostics = this.diagnosticsChangedEmitter.event

    private syncQueue: CoalescingSyncQueue<SyncQueueEntry>

    constructor(vsCodeCollection: DiagnosticCollection) {
        this.vsCodeCollection = vsCodeCollection
        this.syncQueue = new CoalescingSyncQueue(
            (uri: string, entry: SyncQueueEntry, token: CancellationToken) => this.syncToCollection(uri, entry, token),
            (existing, incoming) => combineEntries(existing, incoming)
        )
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

        const entry: SyncQueueEntry = {
            accumulatedParams,
            pendingKind: kind,
            pendingBatch: [...params.diagnostics],
        }

        this.syncQueue.enqueue(accumulatedParams.uri, entry)
    }

    private async syncToCollection(_uri: string, entry: SyncQueueEntry, token: CancellationToken): Promise<void> {
        const nonSilentDiagnostics = entry.accumulatedParams.diagnostics.filter(d => !d.isSilent)
        const vsUri = p2cConverter.asUri(entry.accumulatedParams.uri)
        const vsDiags = await p2cConverter.asDiagnostics(nonSilentDiagnostics, token)
        if (token.isCancellationRequested) {
            return
        }
        this.vsCodeCollection.set(vsUri, vsDiags)
        const collapsedParams = { ...entry.accumulatedParams, diagnostics: entry.pendingBatch }
        this.diagnosticsChangedEmitter.fire(
            new DiagnosticChangeEvent(entry.pendingKind, collapsedParams, entry.accumulatedParams.diagnostics),
        )
    }

    dispose(): void {
        this.syncQueue.dispose()
        this.diagnosticsChangedEmitter.dispose()
    }
}
