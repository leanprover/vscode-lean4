import type { DocumentUri, TextDocumentPositionParams } from 'vscode-languageserver-protocol';
import { RpcCallParams, RpcErrorCode, RpcPtr, RpcReleaseParams } from './lspTypes';

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
 * An RPC session at a specific point in a file.
 * The Lean 4 RPC protocol requires every request to specify a position in the
 * file; only `@[serverRpcMethod]` declarations above this positions are callable.
 * Implementations of this interface bundle the position.
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

    register(o: any) {
        if (o instanceof Object) {
            if (Object.keys(o as {}).length === 1 && 'p' in o && typeof(o.p) !== 'object') {
                this.finalizers.register(o as {}, RpcPtr.copy(o as RpcPtr<any>));
            } else {
                for (const v of Object.values(o as {})) this.register(v);
            }
        } else if (o instanceof Array) {
            for (const e of o) this.register(e);
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
            this.register(result);
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


