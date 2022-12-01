import type { Disposable } from 'vscode-languageserver-protocol';

/**
 * When `fire(...args)` is invoked on an `EventEmitter`, the provided `args` are propagated
 * to all registered handlers. Handlers can be registered using `on`. */
export class EventEmitter<E> {
    private handlers: ((_: E) => void)[] = [];
    current?: E;

    on(handler: (_: E) => void): Disposable {
        this.handlers.push(handler);
        return {
          dispose: () => { this.handlers = this.handlers.filter((h) => h !== handler); }
        };
    }

    fire(event: E): void {
        this.current = event;
        for (const h of this.handlers) {
            h(event);
        }
    }

    dispose(): void {
        this.handlers = [];
    }
}

type ExcludeNonEvent<T, U> = T extends (...args: any) => Promise<void> ? U : never

/**
 * Turn all fields in `T` which extend `(...args: As) => Promise<void>` into event emitter fields
 * `f: EventEmitter<As>`. Other fields are removed. */
export type Eventify<T> = {
    [P in keyof T as ExcludeNonEvent<T[P], P>]:
        T[P] extends (arg: infer A) => Promise<void> ? EventEmitter<A> :
            T[P] extends (...args: infer As) => Promise<void> ? EventEmitter<As> : never
}
