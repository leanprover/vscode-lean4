import type { Disposable } from 'vscode-languageserver-protocol';

/** An `Event` propagates a value it's `fire`d with to all handlers registered using `on`. */
export class Event<E> {
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
 * Turn any response-less async callback field, that is a field `f` extending
 * `(...args: As) => Promise<void>`, into an event field `f: Event<As>`.
 * Other fields are removed.
 */
export type Eventify<T> = {
  [P in keyof T as ExcludeNonEvent<T[P], P>]: T[P] extends (arg: infer A) => Promise<void> ? Event<A> :
                                              (T[P] extends (...args: infer As) => Promise<void> ? Event<As> : never);
};
