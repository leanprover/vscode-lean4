import { AbbreviationProvider } from '@leanprover/unicode-input'
import { Disposable, WebviewPanel, commands, window } from 'vscode'
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

export class AbbreviationView implements Disposable {
    private subscriptions: Disposable[] = []
    private webviewPanel: WebviewPanel | undefined

    constructor(
        private extensionPath: FileUri,
        private abbreviationProvider: AbbreviationProvider,
    ) {
        this.subscriptions.push(commands.registerCommand('lean4.docs.showAbbreviations', () => this.display()))
    }

    async display() {
        if (this.webviewPanel) {
            this.webviewPanel.reveal()
        }
        this.webviewPanel = window.createWebviewPanel(
            'lean4_abbreviationview',
            'AbbreviationView',
            { viewColumn: viewColumnOfInfoView() },
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
            },
        )
        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined
        })

        const leader = this.abbreviationProvider.config.abbreviationCharacter
        const abbreviations = Object.entries(this.abbreviationProvider.getSymbolsByAbbreviation()).map(
            ([abbreviation, symbol]) => ({ Abbreviation: leader + abbreviation, 'Unicode symbol': symbol }),
        )

        this.webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>AbbreviationView</title>
                <script
                    src="${this.webviewUri(this.webviewPanel, 'dist', 'abbreviationview', 'static', 'elements', 'bundled.js')}"
                    type="module"
                ></script>
                <script defer data-id="abbreviationview-script" src="${this.webviewUri(this.webviewPanel, 'dist/abbreviationview.js')}" abbreviations="${escapeHtml(JSON.stringify(abbreviations))}"></script>
            </head>
            <body>
                <vscode-table aria-label="Abbreviations" responsive resizable bordered zebra>
                    <vscode-table-header slot="header">
                        <vscode-table-header-cell>Abbreviation</vscode-table-header-cell>
                        <vscode-table-header-cell>Unicode symbol</vscode-table-header-cell>
                    </vscode-table-header>
                    <vscode-table-body id="abbreviation-table" slot="body">
                    </vscode-table-body>
                </vscode-table>
            </body>
            </html>`
        this.webviewPanel.reveal()
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
