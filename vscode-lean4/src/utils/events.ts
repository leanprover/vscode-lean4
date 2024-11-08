import { Disposable, Event } from 'vscode'

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
