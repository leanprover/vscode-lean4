import * as React from 'react'

import type { StateContainer } from '@leanprover/infoview-api'
import { EditorContext } from './contexts'
import { PersistentStateConnection } from './persistentStateConnection'

/**
 * Like `React.useState`, but stores its state persistently under `key` in `container`.
 * The state survives the component being unmounted and remounted.
 * It can be used in widgets to preserve configuration and other long-term data.
 *
 * - The value must be JSON-serializable.
 * - The setter must be called to persistently store a value under `key`.
 * - `initial` is returned as long as nothing is stored under `key`.
 *   `initial` is not itself persistently stored.
 *   As in `React.useState`, only the `initial` of the first render is used.
 * - Calling the setter with `undefined` removes the stored value
 *   (causing the hook to return `initial` again).
 * - When this hook first runs, it asks the editor for the value.
 *   Until the editor answers, the hook continues to return `initial`.
 *   Then the calling component renders again with the stored value.
 *   - If the setter is called with a value before the editor answers,
 *     that value replaces the previously stored value.
 *   - If the setter is called with a function before the editor answers,
 *     that function is run on `initial` and its output replaces the previously stored value.
 * - Distinct {@link StateContainer}s provide independent mappings:
 *   the same key can map to different values in different containers.
 * - Entries within a single container are shared across all widgets.
 *   Prefix keys with the name of your package and widget module to avoid clashes.
 * - Components that simultaneously use the same `key` and `container` see each others' updates.
 */
export function usePersistentState<S>(
    container: StateContainer,
    key: string,
    initial: S | (() => S),
): [S, React.Dispatch<React.SetStateAction<S>>] {
    const ec = React.useContext(EditorContext)
    const state = ec.persistentState

    // Like `React.useState`, use only the `initial` seen during first render.
    const [initialValue] = React.useState(initial)

    const valueOf = (entry: ReturnType<PersistentStateConnection['get']>): S =>
        entry !== undefined && entry !== 'loading' ? (entry.value as S) : initialValue

    const subscribe = React.useCallback(
        (listener: () => void) => state.subscribe(container, key, listener),
        [state, container, key],
    )
    const entry = React.useSyncExternalStore(subscribe, () => state.get(container, key))

    const setValue = React.useCallback(
        (action: React.SetStateAction<S>) => {
            const prev = valueOf(state.get(container, key))
            const next = typeof action === 'function' ? (action as (prev: S) => S)(prev) : action
            if (next === undefined) state.delete(container, key)
            else state.set(container, key, next)
        },
        // `valueOf` depends only on `initialValue`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state, container, key, initialValue],
    )

    return [valueOf(entry), setValue]
}
