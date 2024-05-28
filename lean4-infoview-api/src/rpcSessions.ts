import type { DocumentUri, Position, TextDocumentPositionParams } from 'vscode-languageserver-protocol'
import { RpcCallParams, RpcErrorCode, RpcPtr, RpcReleaseParams } from './lspTypes'

/**
 * Abstraction of the functionality needed
 * to establish RPC sessions in the Lean server
 * and to make RPC calls.
 * See the Lean module `Lean.Server.Rpc.Basic`.
 *
 * This interface can be implemented both in the infoview
 * (relaying LSP messages from the webview to the extension),
 * as well as in the extension itself
 * (directly sending LSP messages via the
 * `vscode-languageserver-node` library (TODO)).
 */
export interface RpcServerIface {
    /**
     * Creates an RPC session for the given URI and returns the session ID.
     * The implementation of {@link RpcServerIface} takes care
     * to send any required keepalive notifications.
     */
    createRpcSession(uri: DocumentUri): Promise<string>
    /** Closes an RPC session created with {@link createRpcSession}. */
    closeRpcSession(sessionId: string): void
    /** Sends an RPC call to the Lean server. */
    call(request: RpcCallParams): Promise<any>
    /** Sends an RPC reference release notification to the server. */
    release(request: RpcReleaseParams): void
}

/**
 * An {@link RpcSessionForFile} with `call` specialized to a specific position `p`.
 *
 * Morally, this bundles an RPC session
 * with the set of RPC methods
 * available at the position `p`.
 *
 * It is okay to mix RPC references
 * between different {@link RpcSessionAtPos} objects
 * created from the same {@link RpcSessionForFile}.
 */
export interface RpcSessionAtPos {
    /**
     * Invoke an RPC method in the Lean server.
     *
     * @param method fully qualified name of the method to call.
     * @param params arguments to the invoked method.
     * @returns a promise that resolves to the returned value, or an error in case the call fails.
     */
    call<T, S>(method: string, params: T): Promise<S>
}

/**
 * Manages a connection to an RPC session
 * that has been opened for a given file
 * (in the Lean server's worker process for that file).
 *
 * An RPC session keeps track of a set of RPC references
 * that are mutually intelligible,
 * in the sense that any RPC method can be called
 * with any number of references from this set.
 * On the other hand,
 * it is not possible to mix RPC references
 * between different sessions.
 */
class RpcSessionForFile {
    sessionId: Promise<string>
    /**
     * If present, stores a fatal exception
     * indicating that the RPC session can no longer be used.
     * For example: the worker crashed
     */
    failed?: any

    refsToRelease: RpcPtr<any>[] = []
    finalizers: FinalizationRegistry<RpcPtr<any>>

    /** Essentially a cache for {@link at}. See {@link at} for why we need this. */
    sessionsAtPos: Map<string, RpcSessionAtPos> = new Map()

    constructor(
        public uri: DocumentUri,
        public sessions: RpcSessions,
    ) {
        this.sessionId = (async () => {
            try {
                return await sessions.iface.createRpcSession(uri)
            } catch (ex) {
                this.failWithoutClosing(ex)
                throw ex
            }
        })()
        this.sessionId.catch(() => {}) // silence uncaught exception warning

        // Here we hook into the JS GC and send release-reference notifications
        // whenever the GC finalizes a number of `RpcPtr`s. Requires ES2021.
        let releaseTimeout: number | undefined
        this.finalizers = new FinalizationRegistry(ptr => {
            if (this.failed) return
            this.refsToRelease.push(ptr)

            // We release eagerly instead of delaying when this many refs become garbage
            const maxBatchSize = 100
            if (this.refsToRelease.length > maxBatchSize) {
                void this.releaseNow()
                clearTimeout(releaseTimeout)
                releaseTimeout = undefined
            } else if (releaseTimeout === undefined) {
                releaseTimeout = window.setTimeout(() => {
                    void this.releaseNow()
                    releaseTimeout = undefined
                }, 100)
            }
        })
    }

    async releaseNow() {
        const sessionId = await this.sessionId
        if (this.failed || this.refsToRelease.length === 0) return
        this.sessions.iface.release({
            uri: this.uri,
            sessionId,
            refs: this.refsToRelease,
        })
        this.refsToRelease = []
    }

    /**
     * Traverses an object received from the RPC server
     * and registers all contained references
     * for future garbage collection.
     *
     * The function implements a form of "conservative garbage collection"
     * where it treats any subobject `{'p': v}` as a potential RPC reference.
     * Therefore `p` should not be used as a field name on the Lean side
     * to prevent false positives.
     *
     * It is unclear if the false positives will become a big issue.
     * Earlier versions of the extension
     * had manually written registration functions for every type,
     * but those are a lot of boilerplate.
     * If we change back to that approach,
     * we should generate them automatically.
     */
    registerRefs(o: any) {
        if (o instanceof Object) {
            if (Object.keys(o as {}).length === 1 && 'p' in o && typeof o.p !== 'object') {
                this.finalizers.register(o as {}, RpcPtr.copy(o as RpcPtr<any>))
            } else {
                for (const v of Object.values(o as {})) this.registerRefs(v)
            }
        } else if (o instanceof Array) {
            for (const e of o) this.registerRefs(e)
        }
    }

    private failWithoutClosing(reason: any): void {
        this.failed = reason
        // NOTE(WN): the sessions map is keyed by URI rather than ID and by the time this
        // function executes, a new session for the same file may already have been added.
        // So we should only delete the stored session if it's still this one.
        if (this.sessions.sessions.get(this.uri) === this) {
            this.sessions.sessions.delete(this.uri)
        }
    }

    fail(reason: any) {
        this.failWithoutClosing(reason)
        void this.sessionId.then(id => this.sessions.iface.closeRpcSession(id))
    }

    /**
     * Invoke an RPC method in the Lean server.
     *
     * To compute the set of RPC methods that can be called,
     * the server finds the environment `e` at the source code location `this.uri:position`.
     * The callable methods are then all the builtin ones,
     * and all constants in `e` marked with `@[server_rpc_method]`
     * (i.e., the `@[server_rpc_method]` declarations made above `this.uri:position`).
     *
     * @param position within the file identified by {@link uri}, used to resolve the set of available RPC methods.
     * @param method fully qualified name of the method to call.
     * @param params arguments to the invoked method.
     * @returns a promise that resolves to the returned value, or to an error in case the call fails.
     */
    async call(position: Position, method: string, params: any): Promise<any> {
        const sessionId = await this.sessionId
        if (this.failed) throw this.failed
        const tdpp: TextDocumentPositionParams = { position, textDocument: { uri: this.uri } }
        try {
            const result = await this.sessions.iface.call({ method, params, sessionId, ...tdpp })
            this.registerRefs(result)
            // HACK: most of our types are `T | undefined` so try to return something matching that interface
            if (result === null) return undefined
            return result
        } catch (ex: any) {
            if (
                ex?.code === RpcErrorCode.WorkerCrashed ||
                ex?.code === RpcErrorCode.WorkerExited ||
                ex?.code === RpcErrorCode.RpcNeedsReconnect
            ) {
                this.fail(ex)
            }
            throw ex
        }
    }

    /**
     * Returns this session with {@link call} specialized to `position` within the file.
     * This is guaranteed to return the same (by reference) object
     * if called multiple times with the same (by deep comparison) position,
     * on the same {@link RpcSessionForFile}.
     * It can therefore be used as a React dep.
     */
    at(position: Position): RpcSessionAtPos {
        // As JS tradition dictates, we use stringification for deep comparison of `Position`s in a `Map`.
        const posStr = `${position.line}:${position.character}`
        if (this.sessionsAtPos.has(posStr)) return this.sessionsAtPos.get(posStr) as RpcSessionAtPos
        const atPos: RpcSessionAtPos = { call: (method, params) => this.call(position, method, params) }
        this.sessionsAtPos.set(posStr, atPos)
        return atPos
    }
}

/** Manages RPC sessions for multiple files. */
export class RpcSessions {
    /**
     * Contains the active {@link RpcSessionForFile} objects.
     * Once an {@link RpcSessionForFile} is set to failed (e.g. due to a server crash),
     * it is removed from this map.
     * The {@link connect} method will then automatically reconnect
     * the next time it is called.
     */
    sessions: Map<DocumentUri, RpcSessionForFile> = new Map()

    constructor(public iface: RpcServerIface) {}

    private connectCore(uri: DocumentUri): RpcSessionForFile {
        if (this.sessions.has(uri)) return this.sessions.get(uri) as RpcSessionForFile
        const sess = new RpcSessionForFile(uri, this)
        this.sessions.set(uri, sess)
        return sess
    }

    /**
     * Returns an {@link RpcSessionAtPos} for the given document and position.
     * Calling {@link connect} multiple times will return the same
     * session (with the same session ID).
     * A new session is only created if a fatal error occurs (the worker crashes)
     * or the session is closed manually (the file is closed).
     */
    connect(pos: TextDocumentPositionParams): RpcSessionAtPos {
        return this.connectCore(pos.textDocument.uri).at(pos.position)
    }

    /** Closes the session for the given URI. */
    closeSessionForFile(uri: DocumentUri): void {
        void this.sessions.get(uri)?.fail('file closed')
    }

    closeAllSessions(): void {
        for (const k of [...this.sessions.keys()]) this.closeSessionForFile(k)
    }

    dispose(): void {
        this.closeAllSessions()
    }
}
