// @vitest-environment jsdom
import type {
    EditorApi,
    InfoviewApi,
    InfoviewConfig,
    InteractiveGoals,
    LeanDiagnostic,
    LeanFileProgressParams,
    LeanPublishDiagnosticsParams,
    RpcCallParams,
} from '@leanprover/infoview-api'
import { defaultInfoviewConfig, RpcErrorCode } from '@leanprover/infoview-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
    DidChangeTextDocumentParams,
    DocumentUri,
    Location,
    Position,
    TextDocumentContentChangeEvent,
} from 'vscode-languageserver-protocol'
import { DiagnosticSeverity } from 'vscode-languageserver-protocol'
import { renderInfoview } from '../src/index'

// `@vscode-elements/react-elements` contains extensionless ESM imports
// that get rejected by Node's native ESM loader.
vi.mock('@vscode-elements/react-elements', () => ({
    VscodeButton: () => null,
    VscodeTextfield: () => null,
}))

const TEST_URI: DocumentUri = 'file:///Test.lean'

/** A single goal with the given target type. No `SubexprInfo` tags on the type. */
function mkSimpleGoal(target: string): InteractiveGoals {
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

type GoalsMode = { reply: InteractiveGoals } | { error: unknown } | 'suspend'

interface PendingGoalCall {
    resolve(goals: InteractiveGoals): void
    reject(err: unknown): void
    abortSignal?: AbortSignal
}

interface MockEditor {
    serverSubscriptions: Map<string, number>
    clientSubscriptions: Map<string, number>

    api: EditorApi

    /** `getInteractiveGoals` gives the same response at all locations.
     * This controls the response:
     * - `{ reply }`: resolves immediately with the given goals.
     * - `{ error }`: rejects immediately with `error`.
     * - `'suspend'`: stays pending until resolved or rejected via `pendingGoals`. */
    goalsMode: GoalsMode
    /** Currently pending `getInteractiveGoals` requests. */
    pendingGoals: PendingGoalCall[]
    /** Number of currently pending `getInteractiveGoals` requests. */
    numPendingGoals(): number
    /** Number of `getInteractiveGoals` requests made during the editor's lifetime. */
    numGoalCalls: number
}

function initMockEditor(initialGoalsMode: GoalsMode = { reply: { goals: [] } }): MockEditor {
    const pendingGoals: PendingGoalCall[] = []

    const editor: MockEditor = {
        serverSubscriptions: new Map<string, number>(),
        clientSubscriptions: new Map<string, number>(),
        goalsMode: initialGoalsMode,
        pendingGoals,
        numGoalCalls: 0,
        numPendingGoals: () => pendingGoals.length,
        api: {
            saveConfig: async () => {},
            sendClientRequest: async (_uri, method, params, options) => {
                if (method === '$/lean/rpc/call') {
                    const call = params as RpcCallParams
                    switch (call.method) {
                        case 'Lean.Widget.getInteractiveGoals':
                            editor.numGoalCalls += 1
                            if (editor.goalsMode === 'suspend') {
                                return await new Promise<InteractiveGoals>((resolve, reject) => {
                                    const entry: PendingGoalCall = {
                                        resolve: g => {
                                            const idx = pendingGoals.indexOf(entry)
                                            if (idx !== -1) pendingGoals.splice(idx, 1)
                                            resolve(g)
                                        },
                                        reject: err => {
                                            const idx = pendingGoals.indexOf(entry)
                                            if (idx !== -1) pendingGoals.splice(idx, 1)
                                            reject(err)
                                        },
                                        abortSignal: options?.abortSignal,
                                    }
                                    pendingGoals.push(entry)
                                })
                            }
                            if ('error' in editor.goalsMode) {
                                throw editor.goalsMode.error
                            }
                            return editor.goalsMode.reply
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
        },
    }

    return editor
}

interface InitTestDataOptions {
    /** {@link InfoviewConfig.debounceTime} */
    debounceTime?: number
    /** Diagnostics sent in every `textDocument/publishDiagnostics`. */
    diagnostics?: LeanDiagnostic[]
    initialGoalsMode?: GoalsMode
}

interface TestData {
    infoviewContainer: HTMLElement
    editor: MockEditor
    infoviewApi: InfoviewApi
    /** Simulates a document edit where the server elaborates quickly
     * (no non-empty `$/lean/fileProgress` range)
     * and no diagnostics are produced. */
    applyEdit(contentChanges: TextDocumentContentChangeEvent[], newGoals: InteractiveGoals): Promise<void>
    /** Unmounts the infoview contents and removes its DOM container. */
    cleanup(): Promise<void>
}

async function initTestData(options: InitTestDataOptions = {}): Promise<TestData> {
    const initialGoalsMode = options.initialGoalsMode ?? { reply: { goals: [] } }
    const editor = initMockEditor(initialGoalsMode)
    const diagnostics = options.diagnostics ?? []

    const cursorPos = locationAt(0, 0)

    let docVersion = 1
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
                diagnostics,
            }
            await infoviewApi.gotServerNotification('textDocument/publishDiagnostics', diags)
        }
    }

    const applyEdit = async (contentChanges: TextDocumentContentChangeEvent[], newGoals: InteractiveGoals) => {
        editor.goalsMode = { reply: newGoals }
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
        for (const g of editor.pendingGoals) {
            g.resolve({ goals: [] })
        }
        await infoviewApi.serverStopped({ message: 'stopped', reason: 'test cleanup' })
        container.remove()
    }

    // Mount and initialize InfoView
    const container = document.createElement('div')
    document.body.appendChild(container)

    const infoviewApi = renderInfoview(editor.api, container)

    // Wait for React to mount `Main` and subscribe to LSP notifications before firing initial events.
    await vi.waitUntil(
        () =>
            (container.textContent ?? '').includes('Waiting for Lean server to start...') &&
            editor.serverSubscriptions.has('$/lean/fileProgress') &&
            editor.serverSubscriptions.has('textDocument/publishDiagnostics') &&
            editor.clientSubscriptions.has('textDocument/didChange'),
        { timeout: 500, interval: 10 },
    )

    await infoviewApi.changedInfoviewConfig({
        ...defaultInfoviewConfig,
        debounceTime: options.debounceTime ?? 0,
    })
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

    await notifyElaborationFinished()
    await infoviewApi.initialize(cursorPos)

    return { infoviewContainer: container, editor, infoviewApi, applyEdit, cleanup }
}

describe('Info Component', () => {
    let test: TestData | undefined

    afterEach(async () => {
        await test?.cleanup()
        test = undefined
    })

    /* Regression test for https://github.com/leanprover/vscode-lean4/issues/90:
    when `getInteractiveDiagnostics` returns no diagnostics (e.g. because Lake failed),
    fall back to non-interactive LSP diagnostics at the cursor position. */
    it('falls back on non-interactive diagnostics when interactive diagnostics are empty', async () => {
        const lakeDiag: LeanDiagnostic = {
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
            },
            severity: DiagnosticSeverity.Error,
            message: 'lake failed',
        }

        test = await initTestData({
            diagnostics: [lakeDiag],
            initialGoalsMode: { reply: { goals: [] } },
        })

        await vi.waitFor(
            () => {
                expect(test?.infoviewContainer.textContent).toContain('lake failed')
                const spinner = test?.infoviewContainer.querySelector<HTMLSpanElement>(
                    '[data-id="info-status-spinner"]',
                )
                expect(spinner?.style.opacity).toBe('0')
            },
            { timeout: 500, interval: 10 },
        )
    })

    /* Regression test for https://github.com/leanprover/vscode-lean4/issues/679:
    `ContentModified` errors should retry automatically without surfacing an error in the UI. */
    it('retries automatically on ContentModified without showing an error', async () => {
        test = await initTestData({ initialGoalsMode: 'suspend' })

        const pendingCall = await vi.waitUntil(() => test?.editor.pendingGoals[0], { timeout: 500, interval: 10 })

        test.editor.goalsMode = { reply: mkSimpleGoal('goal a') }
        pendingCall.reject({ code: RpcErrorCode.ContentModified, message: 'File changed.' })

        await vi.waitFor(
            () => {
                expect(test?.editor.numGoalCalls).toBeGreaterThanOrEqual(2)
                expect(test?.infoviewContainer.textContent).toContain('goal a')
                expect(test?.infoviewContainer.textContent).not.toContain('Error updating:')
            },
            { timeout: 500, interval: 10 },
        )
    })

    it('aborts and discards out-of-order responses when the cursor moves', async () => {
        test = await initTestData({ initialGoalsMode: 'suspend' })

        const firstCall = await vi.waitUntil(() => test?.editor.pendingGoals[0], { timeout: 500, interval: 10 })

        await test.infoviewApi.changedCursorLocation(locationAt(0, 1))
        const secondCall = await vi.waitUntil(() => test?.editor.pendingGoals.find(c => c !== firstCall), {
            timeout: 500,
            interval: 10,
        })
        expect(firstCall.abortSignal?.aborted).toBe(true)

        secondCall.resolve(mkSimpleGoal('goal b'))
        await vi.waitFor(
            () => {
                expect(test?.infoviewContainer.textContent).toContain('goal b')
            },
            { timeout: 500, interval: 10 },
        )

        // Now resolve the older request out of order; it must not overwrite 'goal b'.
        firstCall.resolve(mkSimpleGoal('goal a'))
        await new Promise(resolve => setTimeout(resolve, 40))
        expect(test.infoviewContainer.textContent).toContain('goal b')
        expect(test.infoviewContainer.textContent).not.toContain('goal a')
    })

    it('debounces rapid cursor movements into at most two goals requests', async () => {
        test = await initTestData({
            debounceTime: 100,
            initialGoalsMode: { reply: mkSimpleGoal('goal a') },
        })

        await vi.waitFor(
            () => {
                expect(test?.infoviewContainer.textContent).toContain('goal a')
            },
            { timeout: 500, interval: 10 },
        )

        const callsBefore = test.editor.numGoalCalls
        test.editor.goalsMode = { reply: mkSimpleGoal('goal intermediate') }

        // Simulate holding an arrow key: 6 rapid cursor moves well within `debounceTime`.
        for (let col = 1; col <= 6; col++) {
            if (col === 6) {
                test.editor.goalsMode = { reply: mkSimpleGoal('goal b') }
            }
            await test.infoviewApi.changedCursorLocation(locationAt(0, col))
            if (col < 6) {
                await new Promise(resolve => setTimeout(resolve, 10))
            }
        }

        await vi.waitFor(
            () => {
                expect(test?.infoviewContainer.textContent).toContain('goal b')
                expect(test?.infoviewContainer.textContent).not.toContain('goal a')
            },
            { timeout: 500, interval: 10 },
        )

        const callsMade = test.editor.numGoalCalls - callsBefore
        expect(callsMade).toBeGreaterThanOrEqual(1)
        expect(callsMade).toBeLessThanOrEqual(2)
    })
})
