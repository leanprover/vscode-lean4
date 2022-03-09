import { renderInfoview, EditorApi } from '@lean4/infoview';
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
