import { createAtom, _allowStateChanges } from 'mobx'
import { Disposable } from 'vscode'

function invariant(condition: boolean, message?: string) {}

/**
 * Extracted from mobx-utils.
 * Creates an observables resource from a sink.
 */
export function fromResource<T>(subscriber: (sink: (newValue: T) => void) => Disposable): IResource<T | undefined>
export function fromResource<T>(
    subscriber: (sink: (newValue?: T) => void) => Disposable,
    getValue: () => T,
): IResource<T>
export function fromResource<T>(
    subscriber: (sink: (newValue?: T) => void) => Disposable,
    getValue: (() => T) | undefined = undefined,
): IResource<T | undefined> {
    let isActive = false
    let isDisposed = false
    let value = getValue ? getValue() : undefined
    let disposable: Disposable

    const initializer = () => {
        invariant(!isActive && !isDisposed)
        isActive = true
        disposable = subscriber((...args) => {
            _allowStateChanges(true, () => {
                if (args.length > 0) {
                    value = args[0]
                } else if (getValue) {
                    value = getValue()
                } else {
                    throw new Error('Either an argument or getValue must be provided')
                }
                atom.reportChanged()
            })
        })
    }

    const suspender = () => {
        if (isActive) {
            isActive = false
            disposable.dispose()
        }
    }

    const atom = createAtom('ResourceBasedObservable', initializer, suspender)

    return {
        current: () => {
            invariant(!isDisposed, 'subscribingObservable has already been disposed')
            const isBeingTracked = atom.reportObserved() as unknown
            if (!isBeingTracked && !isActive) {
                if (getValue) {
                    return getValue()
                } else {
                    console.warn(
                        'Called `get` of a subscribingObservable outside a reaction. Current value will be returned but no new subscription has started',
                    )
                }
            }

            return value
        },
        dispose: () => {
            isDisposed = true
            suspender()
        },
        isAlive: () => isActive,
    }
}

export interface IResource<T> {
    current(): T
    dispose(): void
    isAlive(): boolean
}
