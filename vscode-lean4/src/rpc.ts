export class Rpc {
    private seqNum = 0
    private methods: {[name: string]: (...args: any[]) => Promise<any>} = {}
    private pending: {[seqNum: number]: {resolve: (_: any) => void, reject: (_: string) => void}} = {}

    constructor(readonly sendMessage: (msg: any) => void) {}

    register<T>(methods: T): void {
        this.methods = {...this.methods, ...methods}
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    messageReceived(msg: any): void {
        const {seqNum, name, args, result, exception} = msg
        if (seqNum === undefined) return
        if (name !== undefined) {
            return void (async () => {
                try {
                    this.sendMessage({ seqNum, result: await this.methods[name](...args) })
                } catch (ex) {
                    this.sendMessage({ seqNum, exception: ex === undefined ? 'error' : ex })
                }
            })()
        }
        if (exception !== undefined) {
            this.pending[seqNum].reject(exception)
        } else {
            this.pending[seqNum].resolve(result)
        }
        delete this.pending[seqNum]
    }

    invoke(name: string, args: any[]): Promise<any> {
        this.seqNum += 1
        const seqNum = this.seqNum
        return new Promise((resolve, reject) => {
            this.pending[seqNum] = {resolve, reject};
            this.sendMessage({seqNum, name, args});
        });
    }

    getApi<T>(): T {
        return new Proxy({}, {
            get: (_, prop) => (...args: any) =>
                this.invoke(prop as string, args)
        }) as any
    }
}