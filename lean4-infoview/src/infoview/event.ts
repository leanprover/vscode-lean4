import type { Disposable } from 'vscode-languageserver-protocol'

export class EventEmitter<E> {
    private handlers: ((_: E) => void)[] = []
    private handlersWithKey = new Map<string, ((_: E) => void)[]>()
    current?: E

    /** Register a handler for events emitted by this emitter
     * and return a closure that removed the handler registration.
     *
     * If `key` is specified, only events fired with that key will propagate to this handler.
     */
    on(handler: (_: E) => void, key?: string): Disposable {
        if (key) {
            const handlersForKey = this.handlersWithKey.get(key) ?? []
            handlersForKey.push(handler)
            this.handlersWithKey.set(key, handlersForKey)
        } else {
            this.handlers.push(handler)
        }
        return {
            dispose: () => {
                if (key) {
                    const handlersForKey = this.handlersWithKey.get(key) ?? []
                    this.handlersWithKey.set(key, handlersForKey.filter(h => h !== handler))
                } else {
                    this.handlers = this.handlers.filter(h => h !== handler)
                }
            }
        }
    }

    /**
     * Propagate the event to registered handlers.
     *
     * The event is propagated to all keyless handlers.
     * Furthermore if `key` is provided,
     * the event is also propagated to handlers registered with that key.
     */
    fire(event: E, key?: string): void {
        this.current = event
        for (const h of this.handlers) {
            h(event)
        }
        if (key) {
            const handlersForKey = this.handlersWithKey.get(key) ?? []
            for (const h of handlersForKey) {
                h(event)
            }
        }
    }

    dispose(): void {
        this.handlers = []
    }
}

type ExcludeNonEvent<T, U> = T extends (...args: any) => Promise<void> ? U : never

/**
 * Turn all fields in `T` which extend `(...args: As) => Promise<void>`
 * into event emitter fields `f: EventEmitter<As>`.
 * Other fields are removed.
 */
export type Eventify<T> = {
    [P in keyof T as ExcludeNonEvent<T[P], P>]:
        T[P] extends (arg: infer A) => Promise<void> ? EventEmitter<A> :
            T[P] extends (...args: infer As) => Promise<void> ? EventEmitter<As> : never
}
