import { RpcSessions, RpcCallParams, RpcReleaseParams, RpcSessionAtPos } from '@leanprover/infoview-api'
import * as React from 'react'
import type { DidCloseTextDocumentParams, DocumentUri, TextDocumentPositionParams } from 'vscode-languageserver-protocol'
import { EditorContext } from './contexts'
import { DocumentPosition, useClientNotificationEffect, useEvent } from './util'

const RpcSessionsContext = React.createContext<RpcSessions | undefined>(undefined);

/** Manages a Lean RPC connection by providing an {@link RpcSessionsContext} to the children. */
export function WithRpcSessions({ children }: { children: React.ReactNode }) {
    const ec = React.useContext(EditorContext)
    const [sessions] = React.useState<RpcSessions>(() => new RpcSessions({
        createRpcSession: (uri: DocumentUri) => ec.api.createRpcSession(uri),
        closeRpcSession: (uri: DocumentUri) => ec.api.closeRpcSession(uri),
        call: (params: RpcCallParams) => ec.api.sendClientRequest(params.textDocument.uri, '$/lean/rpc/call', params),
        release: (params: RpcReleaseParams) => void ec.api.sendClientNotification(params.uri, '$/lean/rpc/release', params),
    }))
    React.useEffect(() => {
        // Clean up the sessions on unmount
        return () => sessions.dispose()
    }, [])

    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => {
            sessions.closeSessionForFile(params.textDocument.uri)
        },
        []
    )

    // TODO: only restart files for the server that stopped
    useEvent(ec.events.serverRestarted, () => sessions.closeAllSessions())

    return <RpcSessionsContext.Provider value={sessions}>
        {children}
    </RpcSessionsContext.Provider>
}

const fakeRpcSession: RpcSessionAtPos =
    {call: async () => { throw new Error('no rpc context set') }};

export function useRpcSessionAtTdpp(pos: TextDocumentPositionParams): RpcSessionAtPos {
    return React.useContext(RpcSessionsContext)?.connect(pos) || fakeRpcSession;
}

export function useRpcSessionAtPos(pos: DocumentPosition): RpcSessionAtPos {
    return useRpcSessionAtTdpp(DocumentPosition.toTdpp(pos));
}

export const RpcContext = React.createContext<RpcSessionAtPos>(fakeRpcSession)
