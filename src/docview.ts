/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import axios from 'axios';
import cheerio = require('cheerio');
import { URL } from 'url';
import { commands, Disposable, Uri, ViewColumn, WebviewPanel, window,
     workspace, WebviewOptions, WebviewPanelOptions } from 'vscode';
import * as fs from 'fs';
import { join } from 'path';
import { StaticServer } from './staticserver';

export function mkCommandUri(commandName: string, ...args: any[]): string {
    return `command:${commandName}?${encodeURIComponent(JSON.stringify(args))}`;
}

function findProjectDocumentation(): string | null {
    const html = join(workspace.rootPath, 'html', 'index.html');
    return fs.existsSync(html) ? html : null;
}

export class DocViewProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private currentURL: string | undefined = undefined;
    private backstack: string[] = [];
    private forwardstack: string[] = [];
    constructor(private staticServer?: StaticServer) {
        this.subscriptions.push(
            commands.registerCommand('lean.openDocView', (url) => this.open(url)),
            commands.registerCommand('lean.backDocView', () => this.back()),
            commands.registerCommand('lean.forwardDocView', () => this.forward()),
            commands.registerCommand('lean.openTryIt', (code) => this.tryIt(code)),
            commands.registerCommand('lean.openExample', (file) => this.example(file)),
        );
        void this.offerToOpenProjectDocumentation();
    }

    private async offerToOpenProjectDocumentation() {
        if (!fs.existsSync(join(workspace.rootPath, 'leanpkg.toml'))) return;
        const projDoc = findProjectDocumentation();
        if (!projDoc) return;
        await this.open(Uri.file(projDoc).toString());
    }

    private async tryIt(code: string) {
        const doc = await workspace.openTextDocument({language: 'lean', content: code});
        const editor = await window.showTextDocument(doc, ViewColumn.One);
    }

    private async example(file: string) {
        const doc = await workspace.openTextDocument(Uri.parse(file));
        await window.showTextDocument(doc, ViewColumn.One);
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

            let first = true;
            this.webview.onDidChangeViewState(async () => {
                if (first) {
                    first = false;
                    // super hacky way to show both infoview and docview in a split
                    await commands.executeCommand('workbench.action.focusRightGroup');
                    await commands.executeCommand('workbench.action.moveEditorToBelowGroup');
                }
            });
        }
        return this.webview;
    }

    async fetch(url?: string): Promise<string> {
        if (url) {
            const uri = Uri.parse(url);
            if (uri.scheme === 'file') {
                if (uri.fsPath.endsWith('.html')) {
                    return fs.readFileSync(uri.fsPath).toString();
                }
            } else {
                const {data, headers} = await axios.get<string>(url);
                if (('' + headers['content-type']).startsWith('text/html')) {
                    return data;
                }
            }

            const $ = cheerio.load('<p>');
            $('p').text('Unsupported file. ')
                .append($('<a>').attr('href', url).attr('alwaysExternal', 'true')
                    .text('Open in browser instead.'));
            return $.html();
        } else {
            const $ = cheerio.load('<body>');
            const body = $('body');

            const html = findProjectDocumentation();
            if (html) {
                body.append($('<p>').append($('<a>').attr('href', Uri.file(html).toString())
                    .text('Open documentation of current project')));
            }

            const books = {
                'Theorem Proving in Lean':
                    'https://leanprover.github.io/theorem_proving_in_lean/',
                'Reference Manual': 'https://leanprover.github.io/reference/',
                'Mathematics in Lean': 'https://avigad.github.io/mathematics_in_lean/',
                'Logic and Proof': 'https://leanprover.github.io/logic_and_proof/',
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
            const path = Uri.parse(uri.toString()).fsPath;
            if (this.staticServer) {
                // workaround for https://github.com/microsoft/vscode/issues/89038
                return this.staticServer.mkUri(path);
            } else {
                return this.webview.webview.asWebviewUri(Uri.parse(uri.toString())).toString();
            }
        } else {
            return uri.toString();
        }
    }

    async setHtml(): Promise<void> {
        const {webview} = this.getWebview();

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
            } else if (link.attribs.alwaysExternal) {
                // keep links with alwaysExternal attribute
            } else if (link.attribs.tryitfile) {
                link.attribs.title = link.attribs.title || 'Open code block (in existing file)';
                link.attribs.href = mkCommandUri('lean.openExample', new URL(link.attribs.tryitfile, url).toString());
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

        // javascript search doesn't work
        $('.sphinxsidebar #searchbox').remove();

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

        webview.html = $.html();
    }

    /** Called by the user clicking a link. */
    async open(url?: string): Promise<void> {
        if (url) {
            this.backstack.push(this.currentURL);
            this.forwardstack = [];
        }
        this.currentURL = url;
        await this.setHtml();
    }

    async back(): Promise<void> {
        if (this.backstack.length === 0) {return;}
        this.forwardstack.push(this.currentURL);
        this.currentURL = this.backstack.pop();
        await this.setHtml();
    }

    async forward(): Promise<void> {
        if (this.forwardstack.length === 0) {return;}
        this.backstack.push(this.currentURL);
        this.currentURL = this.forwardstack.pop();
        await this.setHtml();
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
