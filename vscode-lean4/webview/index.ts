import { renderInfoview, EditorApi } from '@lean4/infoview';
// HACK: we only want the types but acquireVsCodeApi doesn't seem importable
import type * as _vsc from 'vscode-webview';
import { Rpc } from '../src/rpc';

const vscodeApi = acquireVsCodeApi();

const rpc = new Rpc((m) => vscodeApi.postMessage(m));
window.addEventListener('message', (e) => rpc.messageReceived(e.data))
const editorApi: EditorApi = rpc.getApi();

const div: HTMLElement | null = document.querySelector('#react_root');
if (div) {
    const infoviewApi = renderInfoview(editorApi, div);
    rpc.register(infoviewApi);
}
