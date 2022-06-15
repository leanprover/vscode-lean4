/**
 * Provides classes to manage an RPC connection to the Lean server.
 * @module
 */
import * as React from 'react'
import type { DidCloseTextDocumentParams, Disposable, DocumentUri } from 'vscode-languageserver-protocol'
import { RpcPtr, RpcCallParams, RpcReleaseParams, RpcErrorCode, isRpcError } from '@lean4/infoview-api'
import { EditorContext, RpcContext } from './contexts'
import { EditorConnection } from './editorConnection'
import { DocumentPosition, useClientNotificationEffect, useEvent } from './util'

class RpcSession implements Disposable {
    #ec: EditorConnection
    #uri: DocumentUri
    /** A timeout mechanism for notifying the server about batches of GC'd refs in fewer messages. */
    #releaseTimeout?: number
    #refsToRelease: RpcPtr<any>[]
    #finalizers: FinalizationRegistry<RpcPtr<any>>
    #closed: boolean = false

    constructor(readonly sessionId: string, uri: DocumentUri, ec: EditorConnection) {
        this.#ec = ec
        this.#uri = uri

        // Here we hook into the JS GC and send release-reference notifications
        // whenever the GC finalizes a number of `RpcPtr`s. Requires ES2021.
        this.#refsToRelease = []
        this.#finalizers = new FinalizationRegistry(ptr => {
            if (this.#closed) return
            if (this.#releaseTimeout !== undefined) clearTimeout(this.#releaseTimeout)
            this.#refsToRelease.push(ptr)

            const sendReleaseNotif = () => {
                if (this.#closed) return
                const params: RpcReleaseParams = {
                    uri: this.#uri,
                    sessionId: this.sessionId,
                    refs: this.#refsToRelease,
                }
                void this.#ec.api.sendClientNotification(this.#uri, '$/lean/rpc/release', params)
                this.#releaseTimeout = undefined
                this.#refsToRelease = []
            }

            // We release eagerly instead of delaying when this many refs become garbage
            const maxBatchSize = 100
            if (this.#refsToRelease.length > maxBatchSize) {
                sendReleaseNotif()
            } else {
                this.#releaseTimeout = window.setTimeout(() => {
                    sendReleaseNotif()
                }, 100)
            }
        })
    }

    async call(pos: DocumentPosition, method: string, params: any): Promise<any> {
        if (this.#closed) throw new Error('RPC connection closed')
        const rpcParams: RpcCallParams = {
            ...DocumentPosition.toTdpp(pos),
            sessionId: this.sessionId,
            method,
            params,
        }
        const val = await this.#ec.api.sendClientRequest(pos.uri, '$/lean/rpc/call', rpcParams)
        // const s = JSON.stringify(val)
        // console.log(`'${method}(${JSON.stringify(params)})' at '${pos.line}:${pos.character}' -> '${s.length < 200 ? s : '(..)'}'`)
        return val;
    }

    registerRef(ptr: RpcPtr<any>) {
        this.#finalizers.register(ptr, RpcPtr.copy(ptr))
    }

    dispose() {
        this.#closed = true;
        void this.#ec.api.closeRpcSession(this.sessionId)
    }
}

/** Provides an interface for making RPC calls to the Lean server. */
export class RpcSessions implements Disposable {
    /** Maps each URI to the connected RPC session, if any, at the corresponding file worker. */
    #connected: Map<DocumentUri, RpcSession>
    /** Like `#connected`, but for sessions which are currently connecting. */
    #connecting: Map<DocumentUri, Promise<RpcSession | undefined>>
    #ec: EditorConnection
    setSelf: (_: (_sess: RpcSessions) => RpcSessions) => void

    constructor(ec: EditorConnection) {
        this.#connected = new Map()
        this.#connecting = new Map()
        this.#ec = ec
        this.setSelf = () => { }
    }

    private async sessionAt(uri: DocumentUri): Promise<RpcSession | undefined> {
        if (this.#connected.has(uri)) return this.#connected.get(uri)
        else if (this.#connecting.has(uri)) return await this.#connecting.get(uri)
        else return undefined
    }

    private connectAt(uri: DocumentUri): void {
        if (this.#connecting.has(uri) || this.#connected.has(uri)) {
            // If we are already connecting then there is nothing to do.
            return;
        }
        let newSesh: Promise<RpcSession | undefined> = this.#ec.api.createRpcSession(uri)
            .then(sessionId => new RpcSession(sessionId, uri, this.#ec))
            .catch(() => {
                this.#connecting.delete(uri)
                return undefined
            })
        this.#connecting.set(uri, newSesh)
        newSesh = newSesh.then((newSesh: RpcSession | undefined) => {
            if (!newSesh) return undefined

            this.#connected.set(uri, newSesh)
            this.#connecting.delete(uri)

            // Trigger a React update when we connect.
            this.setSelf(rs => {
                // The `RpcSessions` object is intentionally global with only a shallow copy here
                const newRs = new RpcSessions(rs.#ec)
                newRs.#connected = rs.#connected
                newRs.#connecting = rs.#connecting
                newRs.setSelf = rs.setSelf
                return newRs
            })

            return newSesh
        })
        // NOTE(WN): because we insert into `#connecting` above, this conditional may only fail
        // if the whole `newSesh` promise chain is executed immediately (if that's even possible).
        // In that case we are either already connected or know we failed to do so, so don't want
        // to mark as connecting.
        if (this.#connecting.has(uri)) {
            this.#connecting.set(uri, newSesh)
        }
    }

    /**
     * Executes an RPC call in the context of `pos`. If the relevant RPC session is not yet
     * connected, returns `undefined` and then triggers a React update. See also `registerRef`.
     */
    async call<T>(pos: DocumentPosition, method: string, params: any): Promise<T | undefined> {
        const sesh = await this.sessionAt(pos.uri)
        if (!sesh) {
            this.connectAt(pos.uri)
            return undefined
        }

        try {
            const ret = await sesh.call(pos, method, params)
            return ret
        } catch (ex: unknown) {
            if (isRpcError(ex) ) {
                if (ex.code === RpcErrorCode.RpcNeedsReconnect) {
                    // Are we reconnecting yet?
                    const uri = pos.uri;
                    if (!this.#connecting.has(uri)) {
                        // force a reconnect.
                        this.ensureSessionClosed(uri)
                        this.connectAt(uri);
                    }
                    return undefined
                }
                // NOTE: these are part of normal control, no need to spam the console
                throw ex
            }
            else {
                throw Error(`Got unexpected error form ${JSON.stringify(ex)}`)
            }
        }
    }

    /**
     * All {@link RpcPtr}s received from the server must be registered for garbage
     * collection through this method. Not doing so is safe but will leak memory.
     */
    registerRef(pos: DocumentPosition, ptr: RpcPtr<any>): void {
        void this.sessionAt(pos.uri).then(sesh => {
            if (sesh) sesh.registerRef(ptr)
            else throw new Error(`tried to register ref in non-existent RPC session ${pos.uri}`)
        })
    }

    /**
     * Returns an identifier for the RPC session at `uri`. When this changes, all components
     * which may use RPC in the context of that document must be re-created to avoid using
     * outdated references.
     */
    sessionIdAt(uri: DocumentUri): string {
        return this.#connected.get(uri)?.sessionId ?? ''
    }

    /** Closes the RPC session at `uri` if there is one connected or connecting. */
    ensureSessionClosed(uri: DocumentUri) {
        this.#connected.get(uri)?.dispose()
        this.#connected.delete(uri)
        void this.#connecting.get(uri)?.then(sesh => {
            sesh?.dispose()
            // NOTE(WN): we defensively guard against the (unlikely) case of multiple connection
            // attempts being made in rapid succession. This can only happen, if ever, when
            // a file is rapidly closed and reopened multiple times.
            if (this.#connected.get(uri)?.sessionId === sesh?.sessionId) {
                // this is not a typo, at the point this lambda executes, the uri
                // has probably been added to `this.#connected` by the promise chain
                // in `connectAt` so we have to remove it again here even though we
                // just did that above.
                this.#connected.delete(uri)
            }
        })
    }

    ensureAllSessionsClosed() {
        [...this.#connected.keys()].forEach(uri => this.ensureSessionClosed(uri));
        [...this.#connecting.keys()].forEach(uri => this.ensureSessionClosed(uri));
    }

    dispose() {
        this.ensureAllSessionsClosed();
    }
}

/** Manages a Lean RPC connection by providing an {@link RpcContext} to the children. */
export function WithRpcSessions({ children }: { children: React.ReactNode }) {
    const ec = React.useContext(EditorContext)
    const [sessions, setSessions] = React.useState<RpcSessions>(new RpcSessions(ec))
    sessions.setSelf = setSessions
    React.useEffect(() => {
        // Clean up the sessions on unmount
        return () => sessions.dispose()
    }, [])

    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => {
            sessions.ensureSessionClosed(params.textDocument.uri)
        },
        []
    )

    useEvent(ec.events.serverRestarted, () => sessions.ensureAllSessionsClosed())

    return <RpcContext.Provider value={sessions}>
        {children}
    </RpcContext.Provider>
}
