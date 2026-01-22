import { ClientRequestOptions, EditorApi } from '@leanprover/infoview-api'

export class Rpc {
    private seqNum = 0
    private methods: { [name: string]: (...args: any[]) => Promise<any> } = {}
    private pending: { [seqNum: number]: { resolve: (_: any) => void; reject: (_: string) => void } } = {}
    /** Resolves when both sides of the channel are ready to receive procedure calls. */
    private initPromise: Promise<void>
    private resolveInit: () => void
    private initialized: boolean = false

    constructor(readonly sendMessage: (msg: any) => void) {
        this.resolveInit = () => {} // pacify the typechecker; the real initializer is below
        this.initPromise = new Promise(resolve => {
            this.resolveInit = resolve
        })
    }

    /** Register procedures that the other side of the channel can invoke. Must be called exactly once. */
    register<T>(methods: T): void {
        if (this.initialized) throw new Error('RPC methods already registered')
        this.methods = { ...methods } as any
        const interval = setInterval(() => {
            this.sendMessage({ kind: 'initialize' })
        }, 50)
        const prevResolveInit = this.resolveInit
        this.resolveInit = () => {
            clearInterval(interval)
            prevResolveInit()
        }
        this.initialized = true
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    messageReceived(msg: any): void {
        if (msg.kind) {
            if (msg.kind === 'initialize') {
                this.sendMessage({ kind: 'initialized' })
            } else if (msg.kind === 'initialized' && this.initialized) {
                this.resolveInit()
            }
            return
        }
        const { seqNum, name, args, result, exception }: any = msg
        if (seqNum === undefined) return
        if (name !== undefined) {
            // It's important that we wait on `initPromise` here. Otherwise we may try to invoke
            // a method before `register` is called.
            return void this.initPromise.then(async () => {
                try {
                    const fn = this.methods[name]
                    if (fn === undefined) throw new Error(`unknown RPC method ${name}`)
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    this.sendMessage({ seqNum, result: await fn(...args) })
                } catch (ex: any) {
                    this.sendMessage({ seqNum, exception: prepareExceptionForSerialization(ex) })
                }
            })
        }
        if (exception !== undefined) {
            this.pending[seqNum].reject(exception as string)
        } else {
            this.pending[seqNum].resolve(result)
        }
        delete this.pending[seqNum]
    }

    async invoke(name: string, args: any[]): Promise<any> {
        await this.initPromise
        this.seqNum += 1
        const seqNum = this.seqNum
        return new Promise((resolve, reject) => {
            this.pending[seqNum] = { resolve, reject }
            this.sendMessage({ seqNum, name, args })
        })
    }

    getApi<T>(): T {
        return new Proxy(
            {},
            {
                get:
                    (_, prop) =>
                    (...args: any[]) =>
                        this.invoke(prop as string, args),
            },
        ) as any
    }
}

function prepareExceptionForSerialization(ex: any): any {
    if (ex === undefined) {
        return 'error'
    } else if (typeof ex === 'object' && !(ex instanceof Array)) {
        /* Certain properties (such as `ex.message`) are not /enumerable/ per ECMAScript
         * and disappear along the way through `Webview.postMessage`; we create a new object
         * so that they make it through. */
        const exOut: any = {}
        for (const p of Object.getOwnPropertyNames(ex)) {
            exOut[p] = ex[p]
        }
        return exOut
    } else {
        return ex
    }
}

export type ClientRequestRpcOptions = Omit<ClientRequestOptions, 'abortSignal'>

/**
 * A version of {@link EditorApi} in which all values are serializable.
 * It is used to pass messages between the editor and the infoview.
 */
export type EditorRpcApi = Omit<EditorApi, 'sendClientRequest'> & {
    startClientRequest(uri: string, method: string, params: any, options?: ClientRequestRpcOptions): Promise<number>
    awaitClientRequest(id: number): Promise<any>
    cancelClientRequest(id: number): Promise<void>
}

interface CancellationData {
    id: number | undefined
    shouldCancel: boolean
    cancelled: boolean
}

/**
 * Wrap {@link EditorRpcApi} in the more convenient {@link EditorApi}.
 * Called during infoview initialization.
 */
export function editorApiOfRpc(api: EditorRpcApi): EditorApi {
    function cancel(d: CancellationData) {
        d.shouldCancel = true
        if (d.id !== undefined && !d.cancelled) {
            void api.cancelClientRequest(d.id)
            d.cancelled = true
        }
    }
    const finalizers = new FinalizationRegistry<CancellationData>(cancel)
    return {
        sendClientRequest(uri, method, params, options) {
            const d: CancellationData = {
                id: undefined,
                shouldCancel: false,
                cancelled: false,
            }
            const promise = (async () => {
                const id = await api.startClientRequest(uri, method, params, { autoCancel: options?.autoCancel })
                d.id = id
                if (d.shouldCancel) cancel(d)
                return api.awaitClientRequest(id)
            })()
            if (options?.abortSignal)
                options.abortSignal.onabort = () => {
                    cancel(d)
                }
            if (options?.autoCancel) finalizers.register(promise, d)
            return promise
        },
        /** NOTE: a spread (`...`) doesn't work due to the use of {@link Proxy} in {@link Rpc}. */
        saveConfig: api.saveConfig,
        sendClientNotification: api.sendClientNotification,
        subscribeServerNotifications: api.subscribeServerNotifications,
        unsubscribeServerNotifications: api.unsubscribeServerNotifications,
        subscribeClientNotifications: api.subscribeClientNotifications,
        unsubscribeClientNotifications: api.unsubscribeClientNotifications,
        copyToClipboard: api.copyToClipboard,
        insertText: api.insertText,
        applyEdit: api.applyEdit,
        showDocument: api.showDocument,
        restartFile: api.restartFile,
        createRpcSession: api.createRpcSession,
        closeRpcSession: api.closeRpcSession,
    }
}
