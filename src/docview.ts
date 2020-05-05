import axios from 'axios';
import cheerio = require('cheerio');
import { URL } from 'url';
import { commands, Disposable, Uri, ViewColumn, WebviewPanel, window,
     workspace, WebviewOptions, WebviewPanelOptions } from 'vscode';
import * as fs from 'fs';
import { join, basename } from 'path';

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
            const options: WebviewOptions & WebviewPanelOptions = {
                enableFindWidget: true,
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            };
            this.webview = window.createWebviewPanel('lean', 'Lean Documentation',
                { viewColumn: 3, preserveFocus: true }, options);
            this.webview.onDidDispose(() => this.webview = null);
        }
        return this.webview;
    }

    async fetch(url?: string): Promise<string> {
        if (url) {
            const uri = Uri.parse(url);
            if (uri.scheme === 'file') {
                return fs.readFileSync(uri.fsPath).toString();
            } else {
                return (await axios.get<string>(url)).data;
            }
        } else {
            const $ = cheerio.load('<body>');
            const body = $('body');

            const html = join(workspace.rootPath, 'html', 'index.html');
            if (fs.existsSync(html)) {
                body.append($('<p>').append($('<a>').attr('href', Uri.file(html).toString())
                    .text('Open documentation of current project (')
                    .append($('<code>').text(join(basename(workspace.rootPath), 'html', 'index.html')))
                    .append(')')));
            }

            const books = {
                'Theorem Proving in Lean':
                    'https://leanprover.github.io/theorem_proving_in_lean/',
                'Reference Manual': 'https://leanprover.github.io/reference/',
                'Mathematics in Lean': 'https://avigad.github.io/mathematics_in_lean/',
            };
            for (const book of Object.getOwnPropertyNames(books)) {
                body.append($('<p>').append($('<a>').attr('href', books[book]).text(book)));
            }

            return $.html();
        }
    }

    private mkRelativeUrl(relative: string, base: string): string {
        const uri = new URL(relative, base);
        if (uri.protocol === 'file:') {
            if (new URL(base).protocol !== 'file:') {
                return '';
            }
            return this.webview.webview.asWebviewUri(Uri.parse(uri.toString())).toString();
        } else {
            return uri.toString();
        }
    }

    async setHtml() {
        const url = this.currentURL;
        let $: CheerioStatic;
        try {
            $ = cheerio.load(await this.fetch(url));
        } catch (e) {
            $ = cheerio.load('<pre>');
            $('pre').text(e.toString());
        }
        for (const style of $('link[rel=stylesheet]').get()) {
            style.attribs.href = this.mkRelativeUrl(style.attribs.href, url);
        }
        for (const script of $('script[src]').get()) {
            script.attribs.src = this.mkRelativeUrl(script.attribs.src, url);
        }
        for (const link of $('a[href]').get()) {
            const tryItMatch = link.attribs.href.match(/\/(?:live|lean-web-editor)\/.*#code=(.*)/);
            if (link.attribs.href.startsWith('#')) {
                // keep relative links
            } else if (tryItMatch) {
                const code = decodeURIComponent(tryItMatch[1]);
                link.attribs.title = link.attribs.title || 'Open code block in new editor';
                link.attribs.href = mkCommandUri('lean.openTryIt', code);
            } else {
                const hrefUrl = new URL(link.attribs.href, url);
                const isExternal = url && new URL(url).origin !== hrefUrl.origin;
                if (!isExternal) {
                    link.attribs.title = link.attribs.title || link.attribs.href;
                    link.attribs.href = mkCommandUri('lean.openDocView', hrefUrl.toString());
                }
            }
        }

        const nav = $('<nav>');
        nav.css('width', '100vw');
        nav.css('position', 'fixed');
        nav.css('top', '0');
        nav.css('right', '0');
        nav.css('text-align', 'right');
        nav.css('z-index', '100');
        nav.prependTo($('body'));
        const navDiv = $('<span>');
        navDiv.css('padding', '4px');
        navDiv.css('padding-right', '20px');
        navDiv.css('z-index', '100');
        navDiv.css('background-color', 'var(--vscode-tab-activeBackground)');
        nav.append(navDiv);
        const fontSize = workspace.getConfiguration('editor').get('fontSize') + 'px';
        const mkLink = (command: string, title: string, text: string) => $('<a>')
            .attr('title', title)
            .attr('href', mkCommandUri(command))
            .css('color', 'var(--vscode-tab-activeForeground)')
            .css('font-family', 'sans-serif')
            .css('font-size', fontSize)
            .css('margin-left', '1em')
            .css('text-decoration', 'none')
            .text(text);
        navDiv.append(mkLink('lean.backDocView', 'back', '⬅ back'));
        navDiv.append(mkLink('lean.forwardDocView', 'forward', 'forward ➡'));
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
