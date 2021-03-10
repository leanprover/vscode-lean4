export interface EventListenerHandle {
    dispose(): void;
}

export class Event<E> {
    handlers: ((_: E) => any)[] = [];

    on(handler: (_: E) => any): EventListenerHandle {
        this.handlers.push(handler);
        return { dispose: () => { this.handlers = this.handlers.filter((h) => h !== handler); } };
    }

    fire(event: E): void {
        for (const h of this.handlers) {
            h(event);
        }
    }

    dispose(): void {
        this.handlers = [];
    }
}
