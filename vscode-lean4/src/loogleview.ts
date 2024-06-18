import { Disposable, ViewColumn, WebviewPanel, commands, window } from 'vscode'
import { VSCodeAbbreviationConfig } from './abbreviation/VSCodeAbbreviationConfig'
import { FileUri } from './utils/exturi'

function escapeHtml(s: string) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

export class LoogleView implements Disposable {
    private subscriptions: Disposable[] = []
    private extensionPath: FileUri

    constructor(extensionPath: FileUri) {
        this.extensionPath = extensionPath
        this.subscriptions.push(
            commands.registerCommand('lean4.loogle.search', async () => {
                let initialQuery: string | undefined
                if (window.activeTextEditor !== undefined && window.activeTextEditor.selection !== undefined) {
                    initialQuery = window.activeTextEditor.document.getText(window.activeTextEditor.selection)
                }
                await this.display(initialQuery)
            }),
        )
    }

    async display(initialQuery?: string | undefined) {
        let column =
            window.activeTextEditor && window.activeTextEditor?.viewColumn
                ? window.activeTextEditor?.viewColumn + 1
                : ViewColumn.Two
        if (column === 4) {
            column = ViewColumn.Three
        }
        const webviewPanel = window.createWebviewPanel(
            'lean4_loogleview',
            'LoogleView',
            { viewColumn: column },
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                enableCommandUris: true,
            },
        )

        webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <meta
                    http-equiv="Content-Security-Policy"
                    content="
                        default-src ${webviewPanel.webview.cspSource} https://loogle.lean-lang.org;
                        script-src ${webviewPanel.webview.cspSource} 'nonce-inline';
                        style-src ${webviewPanel.webview.cspSource} 'unsafe-inline'"
                />
                <title>LoogleView</title>
                <script defer type="module" nonce="inline">
                    document.getElementById("loogleviewRoot").innerHTML = await (await fetch("${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'index.html')}")).text()
                </script>
                <link rel="stylesheet" href="${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'index.css')}">
                <link rel="stylesheet" href="${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'codicons', 'codicon.css')}">
            </head>
            <body>
                <div id="loogleviewRoot" style="min-width: 50em"></div>
                <script defer nonce="inline" src="${this.webviewUri(webviewPanel, 'dist/loogleview.js')}" data-id="loogleview-script" abbreviation-config="${escapeHtml(JSON.stringify(new VSCodeAbbreviationConfig()))}" initial-query="${escapeHtml(initialQuery ?? '')}"></script>
            </body>
            </html>`
        webviewPanel.reveal()
    }

    webviewUri(webviewPanel: WebviewPanel, ...pathSegments: string[]): string | undefined {
        const uri = webviewPanel.webview.asWebviewUri(this.extensionPath.join(...pathSegments).asUri())
        return uri.toString()
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
