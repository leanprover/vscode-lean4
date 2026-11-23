// @vitest-environment jsdom
import type {
    EditorApi,
    InfoviewApi,
    InteractiveGoals,
    LeanFileProgressParams,
    LeanPublishDiagnosticsParams,
    RpcCallParams,
} from '@leanprover/infoview-api'
import { defaultInfoviewConfig } from '@leanprover/infoview-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    DidChangeTextDocumentParams,
    DocumentUri,
    Location,
    Position,
    TextDocumentContentChangeEvent,
} from 'vscode-languageserver-protocol'
import { renderInfoview } from '../src/index'

// `@vscode-elements/react-elements` contains extensionless ESM imports
// that get rejected by Node's native ESM loader.
vi.mock('@vscode-elements/react-elements', () => ({
    VscodeButton: () => null,
    VscodeTextfield: () => null,
}))

const TEST_URI: DocumentUri = 'file:///Test.lean'

/** A single goal with the given target type. No `SubexprInfo` tags on the type. */
function mkGoal(target: string): InteractiveGoals {
    return {
        goals: [
            {
                hyps: [],
                type: { text: target },
            },
        ],
    }
}

function locationAt(line: number, character: number, uri: DocumentUri = TEST_URI): Location {
    const pos: Position = { line, character }
    return { uri, range: { start: pos, end: pos } }
}

async function waitForCondition(predicate: () => boolean, description: () => string, timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (!predicate()) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description()}`)
    }
}

interface MockEditor {
    serverSubscriptions: Map<string, number>
    clientSubscriptions: Map<string, number>
    /** The mock editor returns these goals at all locations. */
    goals: InteractiveGoals
    api: EditorApi
}

function initMockEditor(initialGoals: InteractiveGoals): MockEditor {
    const editor: MockEditor = {
        serverSubscriptions: new Map<string, number>(),
        clientSubscriptions: new Map<string, number>(),
        goals: initialGoals,
        api: {
            saveConfig: async () => {},
            sendClientRequest: async (_uri, method, params) => {
                if (method === '$/lean/rpc/call') {
                    const call = params as RpcCallParams
                    switch (call.method) {
                        case 'Lean.Widget.getInteractiveGoals':
                            return editor.goals
                        case 'Lean.Widget.getInteractiveTermGoal':
                            return null
                        case 'Lean.Widget.getWidgets':
                            return { widgets: [] }
                        case 'Lean.Widget.getInteractiveDiagnostics':
                            return []
                        default:
                            return null
                    }
                }
                return null
            },
            sendClientNotification: async () => {},
            subscribeServerNotifications: async method => {
                editor.serverSubscriptions.set(method, (editor.serverSubscriptions.get(method) ?? 0) + 1)
            },
            unsubscribeServerNotifications: async method => {
                const count = editor.serverSubscriptions.get(method) ?? 0
                if (count <= 1) editor.serverSubscriptions.delete(method)
                else editor.serverSubscriptions.set(method, count - 1)
            },
            subscribeClientNotifications: async method => {
                editor.clientSubscriptions.set(method, (editor.clientSubscriptions.get(method) ?? 0) + 1)
            },
            unsubscribeClientNotifications: async method => {
                const count = editor.clientSubscriptions.get(method) ?? 0
                if (count <= 1) editor.clientSubscriptions.delete(method)
                else editor.clientSubscriptions.set(method, count - 1)
            },
            copyToClipboard: async () => {},
            insertText: async () => {},
            applyEdit: async () => {},
            showDocument: async () => {},
            restartFile: async () => {},
            createRpcSession: async () => 'session-1',
            closeRpcSession: async () => {},
            readPersistentState: async () => undefined,
            savePersistentState: async () => {},
            deletePersistentState: async () => {},
        }
    }

    return editor
}

interface testData {
    container: HTMLElement
    infoviewApi: InfoviewApi
    /** Simulates a document edit where the server elaborates quickly
     * (no non-empty `$/lean/fileProgress` range and no changed diagnostics). */
    applyEdit(contentChanges: TextDocumentContentChangeEvent[], newGoals: InteractiveGoals): Promise<void>
    /** Unmounts the infoview contents and removes its DOM container. */
    cleanup(): Promise<void>
}

async function initTestData(cursorPos: Location, initialGoals: InteractiveGoals): Promise<testData> {
    const editor = initMockEditor(initialGoals)

    const notifyElaborationFinished = async () => {
        if (editor.serverSubscriptions.has('$/lean/fileProgress')) {
            const progress: LeanFileProgressParams = {
                textDocument: { uri: cursorPos.uri, version: docVersion },
                processing: [],
            }
            await infoviewApi.gotServerNotification('$/lean/fileProgress', progress)
        }

        if (editor.serverSubscriptions.has('textDocument/publishDiagnostics')) {
            const diags: LeanPublishDiagnosticsParams = {
                uri: cursorPos.uri,
                version: docVersion,
                diagnostics: [],
            }
            await infoviewApi.gotServerNotification('textDocument/publishDiagnostics', diags)
        }
    }

    let docVersion = 1
    const applyEdit = async (contentChanges: TextDocumentContentChangeEvent[], newGoals: InteractiveGoals) => {
        editor.goals = newGoals
        docVersion += 1

        if (editor.clientSubscriptions.has('textDocument/didChange')) {
            const didChange: DidChangeTextDocumentParams = {
                textDocument: { uri: cursorPos.uri, version: docVersion },
                contentChanges,
            }
            await infoviewApi.sentClientNotification('textDocument/didChange', didChange)
        }

        await notifyElaborationFinished()
    }

    const cleanup = async () => {
        await infoviewApi.serverStopped({ message: 'stopped', reason: 'test cleanup' })
        container.remove()
    }

    // Mount and initialize InfoView
    const container = document.createElement('div')
    document.body.appendChild(container)

    const infoviewApi = renderInfoview(editor.api, container)

    // Wait for React to mount `Main` and subscribe to LSP notifications before firing initial events.
    await waitForCondition(
        () =>
            (container.textContent ?? '').includes('Waiting for Lean server to start...') &&
            editor.serverSubscriptions.has('$/lean/fileProgress') &&
            editor.serverSubscriptions.has('textDocument/publishDiagnostics') &&
            editor.clientSubscriptions.has('textDocument/didChange'),
        () => 'infoview to mount and subscribe to LSP notifications',
    )

    await infoviewApi.changedInfoviewConfig({ ...defaultInfoviewConfig, debounceTime: 0 })
    await infoviewApi.serverRestarted({
        capabilities: {
            experimental: {
                rpcProvider: { rpcWireFormat: 'v1' },
            },
        },
        serverInfo: {
            name: 'Lean 4 server',
            version: '4.36.0',
        },
    })
    await infoviewApi.initialize(cursorPos)

    await notifyElaborationFinished()

    return { container, infoviewApi, applyEdit, cleanup }
}

describe('InfoView tactic state updates', () => {
    let test: testData | undefined

    afterEach(async () => {
        await test?.cleanup()
        test = undefined
    })

    it('refreshes the tactic state after an edit that does not move the cursor', async () => {
        // MVP for https://github.com/leanprover/vscode-lean4/issues/785:
        // a code action causes different goals to appear, leaving the cursor position unchanged.
        test = await initTestData(locationAt(0, 0), mkGoal('n = 1 + n'))

        await waitForCondition(
            () => (test?.container.textContent ?? '').includes('n = 1 + n'),
            () => `initial goal \`n = 1 + n\` to render (got: ${JSON.stringify(test?.container.textContent)})`,
        )

        await test.applyEdit(
            [
                {
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 },
                    },
                    text: 'rw [foo]',
                },
            ],
            mkGoal('n = n.succ'),
        )

        await waitForCondition(
            () => {
                const text = test?.container.textContent ?? ''
                return text.includes('n = n.succ')
            },
            () =>
                `refreshed goal \`n = n.succ\` to render after an edit (got: ${JSON.stringify(test?.container.textContent)})`,
        )

        expect(test.container.textContent).toContain('n = n.succ')
        expect(test.container.textContent).not.toContain('n = 1 + n')
    })
})
