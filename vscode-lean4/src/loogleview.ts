import { Disposable, WebviewPanel, commands, version, window } from 'vscode'
import { VSCodeAbbreviationConfig } from './abbreviation/VSCodeAbbreviationConfig'
import { FileUri } from './utils/exturi'
import { viewColumnOfInfoView } from './utils/viewColumn'

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

    constructor(
        private extensionPath: FileUri,
        private extensionVersion: string,
    ) {
        this.subscriptions.push(commands.registerCommand('lean4.loogle.search', async () => this.search()))
    }

    async search() {
        let initialQuery: string | undefined
        if (window.activeTextEditor !== undefined && window.activeTextEditor.selection !== undefined) {
            initialQuery = window.activeTextEditor.document.getText(window.activeTextEditor.selection)
        }
        await this.display(initialQuery)
    }

    async display(initialQuery?: string | undefined) {
        const webviewPanel = window.createWebviewPanel(
            'lean4_loogleview',
            'LoogleView',
            { viewColumn: viewColumnOfInfoView() },
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
                <script
                    src="${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'elements', 'bundled.js')}"
                    type="module"
                ></script>
                <script defer type="module" nonce="inline">
                    document.getElementById("loogleviewRoot").innerHTML = await (await fetch("${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'index.html')}")).text()
                </script>
                <link rel="stylesheet" href="${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'index.css')}">
                <link rel="stylesheet" id="vscode-codicon-stylesheet" href="${this.webviewUri(webviewPanel, 'dist', 'loogleview', 'static', 'codicons', 'codicon.css')}">
            </head>
            <body>
                <div id="loogleviewRoot" style="min-width: 50em"></div>
                <script defer
                    nonce="inline"
                    src="${this.webviewUri(webviewPanel, 'dist/loogleview.js')}"
                    data-id="loogleview-script"
                    abbreviation-config="${escapeHtml(JSON.stringify(new VSCodeAbbreviationConfig()))}"
                    initial-query="${escapeHtml(initialQuery ?? '')}"
                    vscode-version="${escapeHtml(version)}"
                    extension-version="${escapeHtml(this.extensionVersion)}"></script>
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
