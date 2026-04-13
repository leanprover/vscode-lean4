import { CancellationToken, CancellationTokenSource, Disposable } from 'vscode'

/**
 * A queue that coalesces pending work by string key, processes one entry at a time,
 * and supports cancellation of in-flight work when the same key is re-enqueued.
 *
 * When a key is enqueued while its worker is already running, the in-flight
 * CancellationToken is cancelled. The worker should check the token and bail early.
 * If the worker completes without cancellation, the entry is removed from the queue.
 * If cancelled or errored, the entry stays so the next enqueue can update it.
 */
export class CoalescingSyncQueue<T> implements Disposable {
    private queue: Map<string, T> = new Map()
    private state: { kind: 'idle' } | { kind: 'busy'; key: string; tokenSource: CancellationTokenSource } = {
        kind: 'idle',
    }
    private disposed = false

    constructor(
        private readonly worker: (key: string, value: T, token: CancellationToken) => Promise<void>,
        private readonly merge?: (existing: T, incoming: T) => T,
    ) {}

    enqueue(key: string, value: T): void {
        if (this.state.kind === 'busy' && this.state.key === key) {
            this.state.tokenSource.cancel()
        }

        const existing = this.queue.get(key)
        if (this.merge !== undefined && existing !== undefined) {
            this.queue.set(key, this.merge(existing, value))
        } else {
            this.queue.set(key, value)
        }

        if (this.state.kind === 'idle') {
            this.trigger()
        }
    }

    private trigger(): void {
        queueMicrotask(() => void this.work())
    }

    private async work(): Promise<void> {
        if (this.state.kind === 'busy' || this.disposed) {
            return
        }

        const next = this.queue.entries().next()
        if (next.done) {
            return
        }
        const [key, value] = next.value

        const tokenSource = new CancellationTokenSource()
        this.state = { kind: 'busy', key, tokenSource }
        try {
            await this.worker(key, value, tokenSource.token)
            if (!tokenSource.token.isCancellationRequested && !this.disposed) {
                this.queue.delete(key)
            }
        } finally {
            tokenSource.dispose()
            this.state = { kind: 'idle' }
            if (this.queue.size > 0 && !this.disposed) {
                this.trigger()
            }
        }
    }

    dispose(): void {
        this.disposed = true
        if (this.state.kind === 'busy') {
            this.state.tokenSource.cancel()
        }
        this.queue.clear()
    }
}
