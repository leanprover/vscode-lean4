export class Rpc {
    private seqNum = 0
    private methods: {[name: string]: (...args: any[]) => Promise<any>} = {}
    private pending: {[seqNum: number]: {resolve: (_: any) => void, reject: (_: string) => void}} = {}
    /** Resolves when the other side send us the init message. */
    private initPromise: Promise<void>
    private resolveInit?: () => void

    constructor(readonly sendMessage: (msg: any) => void) {
        this.initPromise = new Promise((resolve) => {
            const interval = setInterval(() => {
                sendMessage({kind: 'initialize'})
            }, 50)
            this.resolveInit = () => {
                // @types/node bug: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/43236
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                clearInterval(interval as any)
                resolve()
            }
        })
    }

    register<T>(methods: T): void {
        this.methods = {...this.methods, ...methods}
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    messageReceived(msg: any): void {
        if (msg.kind) {
            if (msg.kind === 'initialize') {
                this.sendMessage({kind: 'initialized'})
            } else if (msg.kind === 'initialized' && this.resolveInit) {
                this.resolveInit()
            }
            return
        }
        const {seqNum, name, args, result, exception}: any = msg
        if (seqNum === undefined) return
        if (name !== undefined) {
            return void (async () => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    this.sendMessage({ seqNum, result: await this.methods[name](...args) })
                } catch (ex: any) {
                    if (ex === undefined) {
                        this.sendMessage({ seqNum, exception: 'error' })
                        return
                    }
                    /* Certain properties (such as `ex.message`) are not /enumerable/ per ECMAScript
                     * and disappear along the way through `Webview.postMessage`; we create a new object
                     * so that they make it through. */
                    const exOut: any = {}
                    for (const p of Object.getOwnPropertyNames(ex)) { exOut[p] = ex[p] }
                    this.sendMessage({ seqNum, exception: exOut })
                }
            })()
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
            this.pending[seqNum] = {resolve, reject};
            this.sendMessage({seqNum, name, args});
        });
    }

    getApi<T>(): T {
        return new Proxy({}, {
            get: (_, prop) => (...args: any[]) =>
                this.invoke(prop as string, args)
        }) as any
    }
}
