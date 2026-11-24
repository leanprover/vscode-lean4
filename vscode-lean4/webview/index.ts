import type { EditorApi, InfoviewApi, InfoviewConfig, LeanPublishDiagnosticsParams } from '@leanprover/infoview'
import { loadRenderInfoview } from '@leanprover/infoview/loader'
import type { InitializeResult, Location } from 'vscode-languageserver-protocol'
import { EditorRpcApi, Rpc, editorApiOfRpc } from '../src/rpc'
// Type declarations for VSCode APIs.
import 'vscode-webview'

/**
 * Injects the script hosted at `url` into the webview and waits for it to finish executing.
 * If `url` is unreachable, this does nothing.
 * If the request stalls for over `timeoutMs` milliseconds,
 * this does not wait for execution but the script may still run.
 */
async function tryLoadScript(url: string, timeoutMs = 1000): Promise<void> {
    return new Promise<void>(resolve => {
        const s = document.createElement('script')
        const timer = setTimeout(() => {
            s.remove()
            resolve()
        }, timeoutMs)
        s.onload = () => {
            clearTimeout(timer)
            resolve()
        }
        s.onerror = () => {
            clearTimeout(timer)
            s.remove()
            resolve()
        }
        s.src = url
        document.head.appendChild(s)
    })
}

// Even when the Infoview is loaded in a webview panel with the `retainContextWhenHidden` set,
// when the Infoview is detached, it will be reset to its initial state.
// Persisting the most important state necessary for rendering the InfoView ensures that it
// can be rendered correctly when detaching it.
// We persist this state by intercepting the Infoview API and load it when this script is initialized.
interface PersistentInfoviewState {
    config?: InfoviewConfig
    cursorLoc?: Location
    initializeResult?: InitializeResult
    diags?: LeanPublishDiagnosticsParams
}

const vscodeApi = acquireVsCodeApi<PersistentInfoviewState>()

function modifyState(f: (previousState: PersistentInfoviewState) => PersistentInfoviewState) {
    vscodeApi.setState(f(vscodeApi.getState() ?? {}))
}

const rpc = new Rpc((m: any) => vscodeApi.postMessage(m))
window.addEventListener('message', e => rpc.messageReceived(e.data))
const editorApi_: EditorRpcApi = rpc.getApi()
const editorApi: EditorApi = editorApiOfRpc(editorApi_)

const div: HTMLElement | null = document.querySelector('#react_root')
const script: HTMLOrSVGScriptElement | null = document.currentScript
if (div && script) {
    void (async () => {
        const devScriptUrl = script.getAttribute('data-dev-script-url')
        if (devScriptUrl) {
            // Wait for React DevTools to load before the infoview is mounted.
            await tryLoadScript(devScriptUrl)
        }

        const imports = {
            '@leanprover/infoview': script.getAttribute('data-importmap-leanprover-infoview')!,
            react: script.getAttribute('data-importmap-react')!,
            'react/jsx-runtime': script.getAttribute('data-importmap-react-jsx-runtime')!,
            'react-dom': script.getAttribute('data-importmap-react-dom')!,
        }
        loadRenderInfoview(imports, [editorApi, div], async api => {
            const previousState: PersistentInfoviewState | undefined = vscodeApi.getState()

            const apiWithPersistedState: InfoviewApi = { ...api }
            apiWithPersistedState.initialize = async loc => {
                await api.initialize(loc)
                modifyState(s => {
                    return { ...s, cursorLoc: loc }
                })
            }
            apiWithPersistedState.changedCursorLocation = async loc => {
                await api.changedCursorLocation(loc)
                if (loc !== undefined) {
                    modifyState(s => {
                        return { ...s, cursorLoc: loc }
                    })
                }
            }
            apiWithPersistedState.changedInfoviewConfig = async config => {
                await api.changedInfoviewConfig(config)
                modifyState(s => {
                    return { ...s, config }
                })
            }
            apiWithPersistedState.serverRestarted = async initializeResult => {
                await api.serverRestarted(initializeResult)
                modifyState(s => {
                    return { ...s, initializeResult }
                })
            }
            apiWithPersistedState.gotServerNotification = async (method, params) => {
                await api.gotServerNotification(method, params)
                if (method === 'textDocument/publishDiagnostics') {
                    modifyState(s => {
                        return { ...s, diags: params }
                    })
                }
            }

            rpc.register(apiWithPersistedState)

            if (previousState !== undefined) {
                if (previousState.cursorLoc !== undefined) {
                    await api.initialize(previousState.cursorLoc)
                }
                if (previousState.config !== undefined) {
                    await api.changedInfoviewConfig(previousState.config)
                }
                if (previousState.initializeResult !== undefined) {
                    await api.serverRestarted(previousState.initializeResult)
                }
                if (previousState.diags !== undefined) {
                    await api.gotServerNotification('textDocument/publishDiagnostics', previousState.diags)
                }
            }
        })
    })()
}
