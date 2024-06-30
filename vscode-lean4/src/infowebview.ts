import { WebviewPanel, window, Uri, ExtensionContext, ViewColumn } from "vscode";
import { InfoWebviewFactory, InfoWebview } from "./infoview";
import { EditorApi, InfoviewApi } from "@leanprover/infoview-api"
import { Rpc } from "./rpc";
import {
    minIfProd,
    prodOrDev,
} from './config'
import { join } from 'path'

export class VSCodeInfoWebviewFactory implements InfoWebviewFactory {

    constructor(
        private context: ExtensionContext
    ) { }
    
    make(editorApi: EditorApi, stylesheet: string, column: number) {

        const webviewPanel = window.createWebviewPanel(
            'lean4_infoview',
            'Lean Infoview',
            { viewColumn: column, preserveFocus: true },
            {
                enableFindWidget: true,
                retainContextWhenHidden: true,
                enableScripts: true,
                enableCommandUris: true,
            },
        )

        // Note that an extension can send data to its webviews using webview.postMessage().
        // This method sends any JSON serializable data to the webview. The message is received
        // inside the webview through the standard message event.
        // The receiving of these messages is done inside webview\index.ts where it
        // calls window.addEventListener('message',...
        const rpc = new Rpc(m => {
            try {
                void webviewPanel.webview.postMessage(m)
            } catch (e) {
                // ignore any disposed object exceptions
            }
        })
        rpc.register(editorApi)

        // Similarly, we can received data from the webview by listening to onDidReceiveMessage.
        webviewPanel.webview.onDidReceiveMessage(m => {
            try {
                rpc.messageReceived(m)
            } catch {
                // ignore any disposed object exceptions
            }
        })
        const api = rpc.getApi<InfoviewApi>()
        webviewPanel.webview.html = this.initialHtml(webviewPanel, stylesheet)

        return {
            api,
            rpc,
            get visible() {
                return webviewPanel.visible
            },
            dispose: () => {
                webviewPanel.dispose()
            },
            reveal: (viewColumn?: ViewColumn, preserveFocus?: boolean) => { 
                webviewPanel.reveal(viewColumn, preserveFocus)
            },
            onDidDispose: webviewPanel.onDidDispose
        }
    }

    private getLocalPath(path: string, webviewPanel: WebviewPanel) {
        webviewPanel.webview.asWebviewUri(Uri.file(join(this.context.extensionPath, path))).toString()
    }

    private initialHtml(webviewPanel: WebviewPanel, stylesheet: string) {
        const libPostfix = `.${prodOrDev}${minIfProd}.js`
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>Infoview</title>
                <style>${stylesheet}</style>
                <link rel="stylesheet" href="${this.getLocalPath('dist/lean4-infoview/index.css', webviewPanel)}">
            </head>
            <body>
                <div id="react_root"></div>
                <script
                    data-importmap-leanprover-infoview="${this.getLocalPath(`dist/lean4-infoview/index${libPostfix}`, webviewPanel)}"
                    data-importmap-react="${this.getLocalPath(`dist/lean4-infoview/react${libPostfix}`, webviewPanel)}"
                    data-importmap-react-jsx-runtime="${this.getLocalPath(`dist/lean4-infoview/react-jsx-runtime${libPostfix}`, webviewPanel)}"
                    data-importmap-react-dom="${this.getLocalPath(`dist/lean4-infoview/react-dom${libPostfix}`, webviewPanel)}"
                    src="${this.getLocalPath('dist/webview.js', webviewPanel)}"></script>
            </body>
            </html>`
    }
}