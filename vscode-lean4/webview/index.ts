import type { EditorApi } from '@leanprover/infoview'
import { renderInfoview } from '@leanprover/infoview'
import { Rpc } from '../src/rpc'

const vscodeApi = window.parent // acquireVsCodeApi()

const rpc = new Rpc((m: any) => vscodeApi.postMessage(JSON.stringify(m)))
window.addEventListener('message', e => rpc.messageReceived(JSON.parse(e.data)))
const editorApi: EditorApi = rpc.getApi()

const div: HTMLElement | null = document.querySelector('#react_root')

const api = renderInfoview(editorApi, div!)
rpc.register(api)
