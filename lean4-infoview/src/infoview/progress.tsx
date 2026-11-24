import { LeanFileProgressParams, LeanFileProgressProcessingInfo } from '@leanprover/infoview-api'
import * as React from 'react'
import fastIsEqual from 'react-fast-compare'
import type {
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DocumentUri,
} from 'vscode-languageserver-protocol'

import { EditorContext } from './contexts'
import { EventEmitter } from './event'
import { useClientNotificationEffect, useEvent, useServerNotificationEffect } from './util'

/** The version and server processing state of a document. */
export interface DocProgress {
    /** Highest document version reported by `textDocument/didChange` and `$/lean/fileProgress`. */
    version: number
    /** Ranges currently being processed by the Lean server. */
    processing: LeanFileProgressProcessingInfo[]
}

/** Tracks the version and processing progress of each open document,
 * as reported by notifications from the Lean server and editor. */
export class ProgressStore {
    private entries = new Map<DocumentUri, DocProgress>()
    /** Fires with a {@link DocumentUri} whenever the stored {@link DocProgress} for that URI changes. */
    readonly changed = new EventEmitter<DocProgress | undefined, DocumentUri>()

    get(uri: DocumentUri): DocProgress | undefined {
        return this.entries.get(uri)
    }

    onDidChange(params: DidChangeTextDocumentParams): void {
        if (params.contentChanges.length === 0) return
        const uri = params.textDocument.uri
        const version = params.textDocument.version
        const cur = this.entries.get(uri)
        if (cur !== undefined && version <= cur.version) return
        const next: DocProgress = {
            version,
            processing: cur?.processing ?? [],
        }
        this.entries.set(uri, next)
        this.changed.fire(next, uri)
    }

    onFileProgress(params: LeanFileProgressParams): void {
        const uri = params.textDocument.uri
        const version = params.textDocument.version
        const cur = this.entries.get(uri)
        if (cur !== undefined && version < cur.version) return
        if (cur !== undefined && cur.version === version && fastIsEqual(cur.processing, params.processing)) return
        const next: DocProgress = {
            version,
            processing: params.processing,
        }
        this.entries.set(uri, next)
        this.changed.fire(next, uri)
    }

    onDidClose(uri: DocumentUri): void {
        if (!this.entries.delete(uri)) return
        this.changed.fire(undefined, uri)
    }

    clear(): void {
        for (const uri of [...this.entries.keys()]) {
            this.entries.delete(uri)
            this.changed.fire(undefined, uri)
        }
    }
}

export const ProgressContext = React.createContext<ProgressStore>(new ProgressStore())

/** Provides a {@link ProgressStore} via the {@link ProgressContext}.
 * The store has a stable reference identity. */
export function WithProgressStore({ children }: React.PropsWithChildren<{}>) {
    const ec = React.useContext(EditorContext)
    const [store] = React.useState(() => new ProgressStore())

    useServerNotificationEffect(
        '$/lean/fileProgress',
        (params: LeanFileProgressParams) => store.onFileProgress(params),
        [store],
    )

    useClientNotificationEffect(
        'textDocument/didChange',
        (params: DidChangeTextDocumentParams) => store.onDidChange(params),
        [store],
    )

    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => store.onDidClose(params.textDocument.uri),
        [store],
    )

    useEvent(ec.events.serverRestarted, () => store.clear(), [store])

    return <ProgressContext.Provider value={store}>{children}</ProgressContext.Provider>
}
