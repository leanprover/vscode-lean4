import { Disposable } from "vscode-languageserver-protocol";

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

/**
 * Turns response-less async callback fields `f` into events which should fire on `f()` called.
 * Other fields stay as they were.
 */
export type Eventify<T> = {
  [P in keyof T]: T[P] extends (arg: infer A) => Promise<void> ? Event<A> :
                  (T[P] extends (...args: infer As) => Promise<void> ? Event<As> : T[P]);
};