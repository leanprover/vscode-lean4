import type { EditorApi } from '@leanprover/infoview'
import { loadRenderInfoview } from '@leanprover/infoview/loader'
import { Rpc } from '../src/rpc'

const vscodeApi = acquireVsCodeApi()

const rpc = new Rpc((m: any) => vscodeApi.postMessage(m))
window.addEventListener('message', e => rpc.messageReceived(e.data))
const editorApi: EditorApi = rpc.getApi()

const div: HTMLElement | null = document.querySelector('#react_root')
const script: HTMLOrSVGScriptElement | null = document.currentScript
if (div && script) {
    const imports = {
        '@leanprover/infoview': script.getAttribute('data-importmap-leanprover-infoview')!,
        react: script.getAttribute('data-importmap-react')!,
        'react/jsx-runtime': script.getAttribute('data-importmap-react-jsx-runtime')!,
        'react-dom': script.getAttribute('data-importmap-react-dom')!,
    }
    loadRenderInfoview(imports, [editorApi, div], api => rpc.register(api))
}