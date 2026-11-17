import type { EditorApi, StateContainer } from '@leanprover/infoview-api'
import { describe, expect, it, vi } from 'vitest'
import { PersistentStateConnection } from '../src/infoview/persistentStateConnection'

/** The part of {@link EditorApi} that {@link PersistentStateConnection} uses. */
type PersistentStateApi = Pick<EditorApi, 'readPersistentState' | 'savePersistentState' | 'deletePersistentState'>

type State = { [C in StateContainer]: { [key: string]: unknown } }

/** Stores persistent state in memory. Logs calls made by the {@link PersistentStateConnection}. */
function fakeEditor(initial: Partial<State> = {}) {
    const state: State = { infoview: {}, workspace: {}, ...initial }
    const calls: string[] = []
    const has = (container: StateContainer, key: string) => Object.prototype.hasOwnProperty.call(state[container], key)
    const api: PersistentStateApi = {
        readPersistentState: async (container, key) => {
            calls.push(`read ${container} ${key}`)
            return has(container, key) ? { value: state[container][key] } : undefined
        },
        savePersistentState: async (container, key, value) => {
            calls.push(`save ${container} ${key}`)
            state[container][key] = value
        },
        deletePersistentState: async (container, key) => {
            calls.push(`delete ${container} ${key}`)
            delete state[container][key]
        },
    }
    return { connection: new PersistentStateConnection(api as EditorApi), state, calls }
}

/** Waits until the connection has the answers of the editor to all requests so far. */
const editorAnswered = () => new Promise(resolve => setTimeout(resolve))

/** Reads `key` and waits until the connection has the answer of the editor. */
async function load(connection: PersistentStateConnection, container: StateContainer, key: string) {
    connection.get(container, key)
    await editorAnswered()
    return connection.get(container, key)
}

describe('PersistentStateConnection', () => {
    it('asks the editor for a key when the key is first read, and only then', async () => {
        const editor = fakeEditor({ infoview: { a: 1 }, workspace: { b: [2], unused: 3 } })
        const { connection } = editor
        expect(editor.calls).toEqual([])

        expect(connection.get('infoview', 'a')).toBe('loading')
        expect(connection.get('infoview', 'a')).toBe('loading')
        await editorAnswered()
        expect(connection.get('infoview', 'a')).toEqual({ value: 1 })
        expect(await load(connection, 'workspace', 'b')).toEqual({ value: [2] })
        expect(await load(connection, 'workspace', 'missing')).toBeUndefined()
        expect(connection.get('infoview', 'a')).toEqual({ value: 1 })
        expect(editor.calls).toEqual(['read infoview a', 'read workspace b', 'read workspace missing'])
    })

    it('has separate keys for distinct containers', () => {
        const editor = fakeEditor()
        const { connection } = editor
        connection.set('infoview', 'k', 'short')
        connection.set('workspace', 'k', 'long')
        expect(connection.get('infoview', 'k')).toEqual({ value: 'short' })
        expect(connection.get('workspace', 'k')).toEqual({ value: 'long' })
        expect(editor.state).toEqual({ infoview: { k: 'short' }, workspace: { k: 'long' } })
    })

    it('sends writes to the editor', () => {
        const editor = fakeEditor()
        const { connection } = editor
        connection.set('workspace', 'k', { n: 1 })
        connection.set('infoview', 'k', 2)
        expect(editor.calls).toEqual(['save workspace k', 'save infoview k'])
        expect(editor.state).toEqual({ infoview: { k: 2 }, workspace: { k: { n: 1 } } })
    })

    it('deletes a value both in memory and in the editor', () => {
        const editor = fakeEditor()
        const { connection } = editor
        connection.set('workspace', 'k', 1)
        connection.delete('workspace', 'k')
        expect(connection.get('workspace', 'k')).toBeUndefined()
        expect(editor.calls).toEqual(['save workspace k', 'delete workspace k'])
        expect(editor.state.workspace).toEqual({})
    })

    it('does nothing when the value did not change', () => {
        const editor = fakeEditor()
        const { connection } = editor
        const listener = vi.fn()
        connection.subscribe('workspace', 'k', listener)
        connection.set('workspace', 'k', 1)
        const entry = connection.get('workspace', 'k')
        connection.set('workspace', 'k', 1)
        expect(connection.get('workspace', 'k')).toBe(entry)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(editor.calls).toEqual(['save workspace k'])
    })

    it('notifies only the listeners of the changed key, until they unsubscribe', () => {
        const { connection } = fakeEditor()
        const calls: string[] = []
        const listen = (container: StateContainer, key: string) =>
            connection.subscribe(container, key, () => calls.push(`${container} ${key}`))
        const unsubscribe = listen('workspace', 'a')
        listen('workspace', 'a')
        listen('workspace', 'b')
        listen('infoview', 'a')
        connection.set('workspace', 'a', 1)
        expect(calls).toEqual(['workspace a', 'workspace a'])
        unsubscribe()
        connection.set('workspace', 'a', 2)
        expect(calls).toEqual(['workspace a', 'workspace a', 'workspace a'])
    })

    it('notifies listeners once when the editor answers', async () => {
        const { connection } = fakeEditor({ workspace: { k: 1 } })
        const stored = vi.fn()
        const missing = vi.fn()
        connection.subscribe('workspace', 'k', stored)
        connection.subscribe('workspace', 'missing', missing)
        await load(connection, 'workspace', 'k')
        await load(connection, 'workspace', 'missing')
        expect(stored).toHaveBeenCalledTimes(1)
        expect(missing).toHaveBeenCalledTimes(1)
    })

    it('keeps a value that was set while the key was loading', async () => {
        const editor = fakeEditor({ workspace: { k: 'old' } })
        const { connection } = editor
        const listener = vi.fn()
        connection.subscribe('workspace', 'k', listener)
        connection.get('workspace', 'k')
        connection.set('workspace', 'k', 'new')
        await editorAnswered()
        expect(connection.get('workspace', 'k')).toEqual({ value: 'new' })
        expect(editor.state.workspace).toEqual({ k: 'new' })
        expect(listener).toHaveBeenCalledTimes(1)
    })

    it('keeps a deletion that was made while the key was loading', async () => {
        const editor = fakeEditor({ workspace: { k: 'old' } })
        const { connection } = editor
        connection.get('workspace', 'k')
        connection.delete('workspace', 'k')
        await editorAnswered()
        expect(connection.get('workspace', 'k')).toBeUndefined()
        expect(editor.state.workspace).toEqual({})
    })

    it('informs the editor to delete a value that has never been read', () => {
        const editor = fakeEditor({ workspace: { k: 'old' } })
        const { connection } = editor
        connection.delete('workspace', 'k')
        expect(connection.get('workspace', 'k')).toBeUndefined()
        expect(editor.calls).toEqual(['delete workspace k'])
    })

    it('sends a deletion to the editor even if the key is known to be missing, without notifying', async () => {
        const editor = fakeEditor()
        const { connection } = editor
        await load(connection, 'workspace', 'missing')
        const listener = vi.fn()
        connection.subscribe('workspace', 'missing', listener)
        connection.delete('workspace', 'missing')
        expect(listener).not.toHaveBeenCalled()
        expect(editor.calls).toEqual(['read workspace missing', 'delete workspace missing'])
    })

    it('treats a key as missing and stays usable when an editor read fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const calls: string[] = []
        const api: PersistentStateApi = {
            readPersistentState: () => Promise.reject(new Error('no read')),
            savePersistentState: () => Promise.reject(new Error('no save')),
            deletePersistentState: async (container, key) => {
                calls.push(`delete ${container} ${key}`)
            },
        }
        const connection = new PersistentStateConnection(api as EditorApi)
        expect(await load(connection, 'workspace', 'k')).toBeUndefined()
        expect(await load(connection, 'workspace', 'k')).toBeUndefined()
        // The editor may have a value although the read failed.
        connection.delete('workspace', 'k')
        expect(calls).toEqual(['delete workspace k'])
        connection.set('workspace', 'k', 1)
        await editorAnswered()
        expect(connection.get('workspace', 'k')).toEqual({ value: 1 })
        expect(error).toHaveBeenCalledTimes(2)
        error.mockRestore()
    })

    it('distinguishes a stored null from a missing value', async () => {
        const { connection } = fakeEditor({ workspace: { k: null } })
        expect(await load(connection, 'workspace', 'k')).toEqual({ value: null })
        connection.set('infoview', 'k', null)
        expect(connection.get('infoview', 'k')).toEqual({ value: null })
    })
})
