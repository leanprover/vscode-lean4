import type { DocumentUri, TextDocumentPositionParams } from 'vscode-languageserver-protocol';
import { RpcCallParams, RpcErrorCode, RpcPtr, RpcReleaseParams } from './lspTypes';

/**
 * Abstraction of the Lean server interface required for RPC communication.
 *
 * This interface can be implemented both in the infoview (relaying the LSP
 * messages to the extension via webview RPC mechanism), as well as in the
 * extension itself (directly sending the LSP messages via the
 * `vscode-languageserver-node` library (TODO)).
 */
export interface RpcServerIface {
    /**
     * Creates an RPC session for the given uri and returns the session id.
     * The implementation of `RpcServerIface` takes care to send any required
     * keepalive notifications.
     */
    createRpcSession(uri: DocumentUri): Promise<string>;
    /** Closes an RPC session created with `createRpcSession`. */
    closeRpcSession(sessionId: string): void;
    /** Sends an RPC call to the Lean server. */
    call(request: RpcCallParams): Promise<any>;
    /** Sends an RPC reference release notification to the server. */
    release(request: RpcReleaseParams): void;
}

/**
 * An RPC session.  The session object gives access to all the
 * `@[serverRpcMethod]`s available at the position it is initialized with.
 * Morally it is a fixed set of `@[serverRpcMethod]`s together with the RPC
 * reference state (as identified by the session ID on the wire).
 *
 * `RpcRef`s returned by calls from one `RpcSessionAtPos` may only be passed as
 * arguments to RPC calls *on the same `RpcSessionAtPos` object*.
 * Passing an `RpcRef` from one session to another is unsafe.
 *
 * (The Lean 4 RPC protocol requires every request to specify a position in the
 * file; only `@[serverRpcMethod]` declarations above this position are callable.
 * Implementations of this interface bundle the position.
 * The position and session ID remain the same over the whole lifetime of the
 * `RpcSessionAtPos` object.)
 */
export interface RpcSessionAtPos {
    call<T, S>(method: string, params: T): Promise<S>;
}

class RpcSessionForFile {
    sessionId: Promise<string>;
    /**
     * `failed` stores a fatal exception indicating that the RPC session can no longer be used.
     * For example: the worker crashed, etc.
     */
    failed?: any;

    refsToRelease: RpcPtr<any>[] = [];
    finalizers: FinalizationRegistry<RpcPtr<any>>;

    constructor(public uri: DocumentUri, public sessions: RpcSessions) {
        this.sessionId = (async () => {
            try {
                return await sessions.iface.createRpcSession(uri);
            } catch (ex) {
                this.failWithoutClosing(ex);
                throw ex;
            }
        })();
        this.sessionId.catch(() => {}); // silence uncaught exception warning

        // Here we hook into the JS GC and send release-reference notifications
        // whenever the GC finalizes a number of `RpcPtr`s. Requires ES2021.
        let releaseTimeout: number | undefined
        this.finalizers = new FinalizationRegistry(ptr => {
            if (this.failed) return;
            this.refsToRelease.push(ptr)

            // We release eagerly instead of delaying when this many refs become garbage
            const maxBatchSize = 100
            if (this.refsToRelease.length > maxBatchSize) {
                void this.releaseNow();
                clearTimeout(releaseTimeout);
                releaseTimeout = undefined;
            } else if (releaseTimeout === undefined) {
                releaseTimeout = setTimeout(() => {
                    void this.releaseNow()
                    releaseTimeout = undefined;
                }, 100);
            }
        });
    }

    async releaseNow() {
        const sessionId = await this.sessionId;
        if (this.failed || this.refsToRelease.length === 0) return;
        this.sessions.iface.release({
            uri: this.uri,
            sessionId,
            refs: this.refsToRelease,
        });
        this.refsToRelease = [];
    }

    /** Traverses an object received from the RPC server and registers all contained references
     * for future garbage collection.
     *
     * The function implements a form of "conservative garbage collection" where
     * it treats any subobject `{'p': v}` as a potential reference.  Therefore
     * `p` should not be used as a field name on the Lean side to prevent false
     * positives.
     *
     * It is unclear if the false positives will become a big issue.  Earlier
     * versions of the extension had manually written registration functions for
     * every type, but those are a lot of boilerplate.  If we change back to
     * that approach, we should generate them automatically.
     */
    registerRefs(o: any) {
        if (o instanceof Object) {
            if (Object.keys(o as {}).length === 1 && 'p' in o && typeof(o.p) !== 'object') {
                this.finalizers.register(o as {}, RpcPtr.copy(o as RpcPtr<any>));
            } else {
                for (const v of Object.values(o as {})) this.registerRefs(v);
            }
        } else if (o instanceof Array) {
            for (const e of o) this.registerRefs(e);
        }
    }

    private failWithoutClosing(reason: any): void {
        this.failed = reason;
        this.sessions.sessions.delete(this.uri);
    }

    fail(reason: any) {
        this.failWithoutClosing(reason);
        void this.sessionId.then((id) => this.sessions.iface.closeRpcSession(id));
    }

    async call(pos: TextDocumentPositionParams, method: string, params: any): Promise<any> {
        const sessionId = await this.sessionId;
        if (this.failed) throw this.failed;
        try {
            const result = await this.sessions.iface.call({ method, params, sessionId, ... pos });
            this.registerRefs(result);
            return result;
        } catch (ex: any) {
            if (ex?.code === RpcErrorCode.WorkerCrashed || ex?.code === RpcErrorCode.WorkerExited ||
                    ex?.code === RpcErrorCode.RpcNeedsReconnect) {
                this.fail(ex);
            }
            throw ex;
        }
    }

    at(pos: TextDocumentPositionParams): RpcSessionAtPos {
        return { call: (method, params) => this.call(pos, method, params) };
    }
}

/** Manages RPC sessions for multiple files. */
export class RpcSessions {
    /**
     * Contains the active `RpcSessionForFile` objects.
     * Once an `RpcSessionForFile` is set to failed (e.g. due to a server crash),
     * it is removed from this map.  The `connect` method will then automatically
     * reconnect the next time it is called.
     */
    sessions: Map<DocumentUri, RpcSessionForFile> = new Map();

    constructor(public iface: RpcServerIface) {}

    private connectCore(uri: DocumentUri): RpcSessionForFile {
        if (this.sessions.has(uri)) return this.sessions.get(uri) as RpcSessionForFile;
        const sess = new RpcSessionForFile(uri, this);
        this.sessions.set(uri, sess);
        return sess;
    }

    /**
     * Returns an `RpcSessionAtPos` for the given position.
     * Calling `connect` multiple times will return the same
     * session (with the same session ID).
     * A new session is only created if a fatal error occurs (i.e., the worker
     * crashes) or the session is closed manually (if the file is closed).
     */
    connect(pos: TextDocumentPositionParams): RpcSessionAtPos {
        return this.connectCore(pos.textDocument.uri).at(pos);
    }

    /* Closes the session for the given Uri. */
    closeSessionForFile(uri: DocumentUri): void {
        void this.sessions.get(uri)?.fail('file closed');
    }

    closeAllSessions(): void {
        for (const k of [...this.sessions.keys()]) this.closeSessionForFile(k);
    }

    dispose(): void {
        this.closeAllSessions();
    }
}


