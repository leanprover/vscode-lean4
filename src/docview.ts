import axios from 'axios';
// tslint:disable-next-line:no-var-requires
const cheerio = require('cheerio');
import { URL } from 'url';
import { commands, Disposable, Position, Uri, ViewColumn, WebviewPanel, window,
     workspace, WorkspaceEdit } from 'vscode';

export function mkCommandUri(commandName: string, ...args: any): string {
    return `command:${commandName}?${encodeURIComponent(JSON.stringify(args))}`;
}

export class DocViewProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private currentURL: string | undefined = undefined;
    private backstack: string[] = [];
    private forwardstack: string[] = [];
    constructor() {
        this.subscriptions.push(
            commands.registerCommand('lean.openDocView', (url) => this.open(url)),
            commands.registerCommand('lean.backDocView', () => this.back()),
            commands.registerCommand('lean.forwardDocView', () => this.forward()),
            commands.registerCommand('lean.openTryIt', (code) => this.tryIt(code)),
        );
    }

    private async tryIt(code: string) {
        const doc = await workspace.openTextDocument({language: 'lean', content: code});
        const editor = await window.showTextDocument(doc, ViewColumn.One);
    }

    private webview?: WebviewPanel;
    private getWebview(): WebviewPanel {
        if (!this.webview) {
            this.webview = window.createWebviewPanel('lean', 'Lean Documentation',
                {viewColumn: 3},
                {enableFindWidget: true, enableScripts: true, enableCommandUris: true});
            this.webview.onDidDispose(() => this.webview = null);
        }
        return this.webview;
    }

    async fetch(url?: string): Promise<string> {
        if (url) {
            return (await axios.get<string>(url)).data;
        } else {
            const books = {
                'Theorem Proving in Lean':
                    'https://leanprover.github.io/theorem_proving_in_lean/',
                'Reference Manual': 'https://leanprover.github.io/reference/',
            };
            return '<ul>' +
                Object.getOwnPropertyNames(books).map((n) =>
                    `<li><a href="${books[n]}">${n}</a></li>`).join('') +
                '</ul>';
        }
    }

    async setHtml() {
        const url = this.currentURL;
        const $ = cheerio.load(await this.fetch(url));
        for (const style of $('link[rel=stylesheet]').get()) {
            style.attribs.href = new URL(style.attribs.href, url).toString();
        }
        for (const script of $('script[src]').get()) {
            script.attribs.src = new URL(script.attribs.src, url).toString();
        }
        for (const link of $('a[href]').get()) {
            const tryItMatch = link.attribs.href.match(/\/live\/.*#code=(.*)/);
            if (tryItMatch) {
                const code = decodeURIComponent(tryItMatch[1]);
                link.attribs.href = mkCommandUri('lean.openTryIt', code);
            } else {
                const href = new URL(link.attribs.href, url).toString();
                link.attribs.href = mkCommandUri('lean.openDocView', href);
            }
        }
        $(`<nav style="
                width:100vw; position : fixed; top : 0px; left : 0px;
                padding : 4px; background : #f3f3f3; z-index:100
              ">
            <a href="${mkCommandUri('lean.backDocView')}" title="back">← back</a>
            <a href="${mkCommandUri('lean.forwardDocView')}" title="forward">→ forward</a>
        </nav>`).prependTo('body');
        $('nav+*').css('margin-top','3em');
        this.getWebview().webview.html = $.html();
    }

    /** Called by the user clicking a link. */
    async open(url?: string) {
        if (url) {
            this.backstack.push(this.currentURL);
            this.forwardstack = [];
        }
        this.currentURL = url;
        await this.setHtml();
    }

    async back() {
        if (this.backstack.length === 0) {return;}
        this.forwardstack.push(this.currentURL);
        this.currentURL = this.backstack.pop();
        await this.setHtml();
    }

    async forward() {
        if (this.forwardstack.length === 0) {return;}
        this.backstack.push(this.currentURL);
        this.currentURL = this.forwardstack.pop();
        await this.setHtml();
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
