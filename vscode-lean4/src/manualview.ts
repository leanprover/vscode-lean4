import { promises as fs } from 'fs'
import markdownit from 'markdown-it'
import anchor from 'markdown-it-anchor'
import { Disposable, Uri, WebviewPanel, commands, window } from 'vscode'
import { FileUri } from './utils/exturi'
import { viewColumnOfActiveTextEditor } from './utils/viewColumn'

export class ManualView implements Disposable {
    private subscriptions: Disposable[] = []
    private extensionPath: FileUri
    private manualFile: FileUri
    private webviewPanel: WebviewPanel | undefined

    constructor(extensionPath: FileUri, manualFile: FileUri) {
        this.extensionPath = extensionPath
        this.manualFile = manualFile
        this.subscriptions.push(commands.registerCommand('lean4.docs.showExtensionManual', () => this.displayManual()))
    }

    async displayManual() {
        if (this.webviewPanel !== undefined) {
            this.webviewPanel.reveal()
            return
        }

        this.webviewPanel = window.createWebviewPanel(
            'lean4_manualview',
            'Lean 4 VS Code Extension Manual',
            { viewColumn: viewColumnOfActiveTextEditor() },
            {
                enableFindWidget: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            },
        )
        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = undefined
        })

        const manualContents = await fs.readFile(this.manualFile.fsPath, 'utf8')

        const md = markdownit({ breaks: true, html: true })

        const proxy: markdownit.Renderer.RenderRule = (tokens, idx, options, _, self) =>
            self.renderToken(tokens, idx, options)

        // Center all tables.
        const defaultTableOpenRenderer = md.renderer.rules.table_open ?? proxy
        md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
            return `<center>${defaultTableOpenRenderer(tokens, idx, options, env, self)}`
        }
        const defaultTableCloseRenderer = md.renderer.rules.table_close ?? proxy
        md.renderer.rules.table_close = (tokens, idx, options, env, self) => {
            return `${defaultTableCloseRenderer(tokens, idx, options, env, self)}</center>`
        }

        // Scale all images to at most 70% so that they don't take up too much space.
        const defaultImageRenderer = md.renderer.rules.image ?? proxy
        md.renderer.rules.image = (tokens, idx, options, env, self) => {
            tokens[idx].attrSet('style', 'max-width: 70%')
            return defaultImageRenderer(tokens, idx, options, env, self)
        }

        // In order to render local resources in VS Code webviews, local file URIs
        // first need to be converted to a webview URI with the correct authority
        // using `Webview.asWebviewUri`. This function converts all file URLs to
        // webview URIs.
        md.normalizeLink = url => {
            if (this.webviewPanel === undefined) {
                return url
            }
            if (url.startsWith('#') || url.startsWith('command:')) {
                return url
            }
            // `Uri.parse` defaults to a scheme of `file://` for URIs without a scheme
            const uri = FileUri.fromUri(Uri.parse(url, false))
            if (uri === undefined) {
                return url
            }
            const resourceUri = this.extensionPath.join('manual', uri.fsPath).asUri()
            const webviewResourceUri = this.webviewPanel.webview.asWebviewUri(resourceUri)
            return webviewResourceUri.toString()
        }

        this.webviewPanel.webview.html = md.use(anchor).render(manualContents)
        this.webviewPanel.reveal()
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
