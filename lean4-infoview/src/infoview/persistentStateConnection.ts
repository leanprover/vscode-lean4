import type { EditorApi, StateContainer } from '@leanprover/infoview-api'

/** Persistent key-value store connected to the editor via {@link EditorApi}.
 *
 * The store asks the editor for the value of a key when the key is first read,
 * and keeps the answer in memory.
 * Later reads of the key come from memory.
 * Writes go to memory at once and to the editor in the background.
 *
 * Distinct {@link StateContainer}s provide independent mappings:
 * the same key can map to different values in different containers. */
export class PersistentStateConnection {
    /** Entries that have been loaded or set during this object's lifetime.
     * Keyed by {@link entryId}.
     * IDs mapping to `undefined` are missing from their container.
     * IDs mapping to `'loading'` have been requested from the editor.
     * Missing IDs have not been requested or written yet. */
    private entries: Map<string, { readonly value: unknown } | undefined | 'loading'> = new Map()

    constructor(private api: EditorApi) {}

    /** Returns an object wrapping the value stored under `key` in `container`,
     * or `undefined` if no value is stored.
     *
     * If this store has not read `key` from `container` yet,
     * this schedules the value to be loaded (if it isn't already loading)
     * and returns `'loading'`.
     * Listeners subscribed to this `key` and `container` will be called
     * when the value finishes loading.
     *
     * Reference identity of wrapper objects partly tracks value identity:
     * two `get` outputs are guaranteed reference-inequal
     * when wrapped values are reference-inequal. */
    get(container: StateContainer, key: string): { readonly value: unknown } | undefined | 'loading' {
        const id = entryId(container, key)
        if (!this.entries.has(id)) {
            void this.api
                .readPersistentState(container, key)
                .catch(ex => {
                    console.error(`Failed to load persistent state (container: '${container}', key: '${key}'):`, ex)
                    // Entry failed to load, default to missing.
                    return undefined
                })
                .then(entry => {
                    const currentEntry = this.entries.get(id)
                    // Entry was set or deleted before editor answered. That overrides the answer.
                    if (currentEntry !== 'loading') return
                    this.entries.set(id, entry)
                    this.notify(id)
                })
            this.entries.set(id, 'loading')
        }
        return this.entries.get(id)
    }

    /** Stores `value` under `key` in `container`.
     * `value` must be JSON-serializable, in particular mustn't be `undefined`. */
    set(container: StateContainer, key: string, value: unknown): void {
        const id = entryId(container, key)
        const entry = this.entries.get(id)
        // If the same value is already stored, do nothing.
        if (entry !== undefined && entry !== 'loading' && Object.is(entry.value, value)) return
        this.entries.set(id, { value })
        void this.api
            .savePersistentState(container, key, value)
            .catch(ex =>
                console.error(`Failed to save persistent state (container: '${container}', key: '${key}'):`, ex),
            )
        this.notify(id)
    }

    /** Deletes the value stored under `key` in `container`, if any. */
    delete(container: StateContainer, key: string): void {
        // Dispatch deletion regardless of what we have in `entries`,
        // since failed reads also put `undefined` in `entries`.
        void this.api
            .deletePersistentState(container, key)
            .catch(ex =>
                console.error(`Failed to delete persistent state (container: '${container}', key: '${key}'):`, ex),
            )
        const id = entryId(container, key)
        const isKnown = this.entries.has(id)
        const entry = this.entries.get(id)
        // If key is already saved as unmapped, do not notify.
        if (isKnown && entry === undefined) return
        this.entries.set(id, undefined)
        this.notify(id)
    }

    /** Closures to run when the entry stored under the given key changes. */
    private listeners: Map<string, Set<() => void>> = new Map()

    /** Registers `listener` to be called whenever the entry stored under `key` in `container` changes.
     * Returns a function that removes the listener. */
    subscribe(container: StateContainer, key: string, listener: () => void): () => void {
        const id = entryId(container, key)
        let listeners = this.listeners.get(id)
        if (listeners === undefined) {
            listeners = new Set()
            this.listeners.set(id, listeners)
        }
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
            if (listeners.size === 0 && this.listeners.get(id) === listeners) this.listeners.delete(id)
        }
    }

    private notify(id: string) {
        const listeners = this.listeners.get(id)
        if (listeners === undefined) return
        for (const listener of [...listeners]) listener()
    }
}

/** Used to separate same-key entries in different containers. */
function entryId(container: StateContainer, key: string): string {
    return `${container}:${key}`
}
