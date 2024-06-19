import { AbbreviationProvider } from '@leanprover/unicode-input'
import { Disposable, ViewColumn, WebviewPanel, commands, window } from 'vscode'
import { FileUri } from './utils/exturi'

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
            { viewColumn: ViewColumn.Beside },
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
                <script defer data-id="abbreviationview-script" src="${this.webviewUri(this.webviewPanel, 'dist/abbreviationview.js')}" abbreviations="${escapeHtml(JSON.stringify(abbreviations))}"></script>
            </head>
            <body>
                <vscode-data-grid id="abbreviation-grid" aria-label="Abbreviations" grid-template-columns="20em 1fr"></vscode-data-grid>
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
