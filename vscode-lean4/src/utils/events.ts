import { Disposable, Event, EventEmitter } from 'vscode'

export function onNextEvent<T>(ev: Event<T>, listener: (e: T) => any): Disposable {
    const d = ev(e => {
        d.dispose()
        listener(e)
    })
    return d
}

export function onEventWhile<T>(ev: Event<T>, listener: (e: T) => Promise<'Continue' | 'Stop'>): Disposable {
    const d = ev(async e => {
        const r = await listener(e)
        if (r === 'Stop') {
            d.dispose()
        }
    })
    return d
}

export function withoutReentrancy<V, R>(onReentrancy: R, f: (v: V) => Promise<R>): (v: V) => Promise<R> {
    let isRunning = false
    return async v => {
        if (isRunning) {
            return onReentrancy
        }
        isRunning = true

        try {
            return await f(v)
        } finally {
            isRunning = false
        }
    }
}

export function actionWithoutReentrancy<T>(f: (v: T) => Promise<void>): (v: T) => Promise<void> {
    let isRunning = false
    return async v => {
        if (isRunning) {
            return
        }
        isRunning = true

        try {
            await f(v)
        } finally {
            isRunning = false
        }
    }
}

export function combine<T>(
    ev1: Event<T>,
    filter1: (e1: T) => boolean,
    ev2: Event<T>,
    filter2: (e2: T) => boolean,
): { disposable: Disposable; event: Event<T> } {
    const emitter = new EventEmitter<T>()
    const d1 = ev1(e1 => {
        if (filter1(e1)) {
            emitter.fire(e1)
        }
    })
    const d2 = ev2(e2 => {
        if (filter2(e2)) {
            emitter.fire(e2)
        }
    })
    return {
        disposable: Disposable.from(d1, d2),
        event: emitter.event,
    }
}
