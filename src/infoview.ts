import { join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, TextEditor, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace, env,
} from 'vscode';
import { LeanClient } from './leanclient';
import { RpcExtension } from '@sap-devx/webview-rpc/out.ext/rpc-extension'
import { InfoviewExtensionApi, InfoviewWebviewApi, obtainApi,
    PinnedLocation, registerApi, locationEq, InfoviewLocation,
    Message, InfoViewTacticStateFilter } from './infoviewApi'

function getInfoViewStyle(): string {
    return workspace.getConfiguration('lean4').get('infoViewStyle');
}

function getInfoViewAutoOpen(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpen');
}

function getInfoViewAutoOpenShowGoal(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpenShowGoal', true);
}

function getInfoViewAllErrorsOnLine(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAllErrorsOnLine', true);
}

function getInfoViewTacticStateFilters(): InfoViewTacticStateFilter[] {
    return workspace.getConfiguration('lean4').get('infoViewTacticStateFilters', []);
}

function getInfoViewFilterIndex(): number {
    return workspace.getConfiguration('lean4').get('infoViewFilterIndex', -1);
}

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private subscriptions: Disposable[] = [];
    private webviewRpc: RpcExtension;
    private webviewApi?: InfoviewWebviewApi;

    private started: boolean = false;

    private pins: PinnedLocation[] | null;

    private stylesheet: string = null;

    private extensionApi: InfoviewExtensionApi = {
        copyText: async (text) => {
            await env.clipboard.writeText(text);
            await window.showInformationMessage(`Copied to clipboard: ${text}`);
        },

        syncPins: async (pins) => this.pins = pins,

        requestPlainGoal: async (loc: InfoviewLocation) =>
            await this.client.requestPlainGoals(await workspace.openTextDocument(Uri.parse(loc.uri)),
                this.positionOfLocation(loc)),

        reveal: async (loc) =>
            await this.revealEditorPosition(Uri.parse(loc.uri), loc.line, loc.character),

        insertText: async (text, type, loc) =>
            await this.handleInsertText(text, type, loc),
    };

    constructor(private client: LeanClient, private leanDocs: DocumentSelector, private context: ExtensionContext) {
        this.updateStylesheet();
        this.subscriptions.push(
            this.client.restarted(async () => {
                await this.autoOpen();
                await this.webviewApi?.restarted();
                await this.sendMessages();
            }),
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration(async (e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                await this.sendConfig();
            }),
            this.client.diagnostics(() => void this.sendMessages()),
            workspace.onDidChangeTextDocument(async (e) => {
                if (this.pins && this.pins.length !== 0) {
                    // stupid cursor math that should be in the vscode API
                    let changed: boolean = false;
                    this.pins = this.pins.map(pin => {
                        if (pin.uri !== e.document.uri.toString()) { return pin; }
                        let newPosition = this.positionOfLocation(pin);
                        for (const chg of e.contentChanges) {
                            if (newPosition.isAfterOrEqual(chg.range.start)) {
                                let lines = 0;
                            for (const c of chg.text) if (c === '\n') lines++;
                            newPosition = new Position(
                                chg.range.start.line + Math.max(0, newPosition.line - chg.range.end.line) + lines,
                                newPosition.line > chg.range.end.line ?
                                newPosition.character :
                                lines === 0 ?
                                chg.range.start.character + Math.max(0, newPosition.character - chg.range.end.character) + chg.text.length :
                                9999 // too lazy to get column positioning right, and end of the line is a good place
                                );
                            }
                        }
                        newPosition = e.document.validatePosition(newPosition);
                        const newPin: InfoviewLocation = {
                            line: newPosition.line,
                            character: newPosition.character,
                            uri: pin.uri,
                        };
                        if (!locationEq(newPin, pin)) { changed = true; }
                        return { ...newPin, key: pin.key };
                    });
                    if (changed) {
                        await this.webviewApi?.syncPins(this.pins);
                    }
                    await this.sendPosition();
                }
            }),
            commands.registerTextEditorCommand('lean4.displayGoal', (editor) => this.openPreview(editor)),
            commands.registerTextEditorCommand('lean4.displayList', async (editor) => {
                await this.openPreview(editor);
                await this.webviewApi?.toggleAllMessages();
            }),
            commands.registerTextEditorCommand('lean4.infoView.copyToComment',() => this.webviewApi?.copyToComment()),
            commands.registerCommand('lean4.infoView.toggleUpdating', () => this.webviewApi?.toggleUpdating()),
            commands.registerTextEditorCommand('lean4.infoView.toggleStickyPosition', () => this.webviewApi?.togglePin()),
        );
        if (this.client.isStarted()) {
            void this.autoOpen();
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private updateStylesheet() {
        const fontFamily =
            workspace.getConfiguration('editor').get<string>('fontFamily').replace(/['"]/g, '');
        const fontCodeCSS = `
            .font-code {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
        `;
        const configCSS = getInfoViewStyle();
        this.stylesheet = fontCodeCSS + configCSS;
    }

    private async autoOpen() {
        if (!this.started && getInfoViewAutoOpen()) {
            this.started = true;
            await this.openPreview(window.activeTextEditor);
        }
    }

    private async openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
        const loc = this.getActiveCursorLocation();
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            this.webviewPanel = window.createWebviewPanel('lean4', 'Lean Infoview',
                { viewColumn: column, preserveFocus: true },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                });
            this.webviewRpc = new RpcExtension(this.webviewPanel.webview);
            registerApi(this.webviewRpc, this.extensionApi);
            this.webviewApi = obtainApi(this.webviewRpc);
            this.webviewPanel.webview.html = this.initialHtml();
            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = null;
                this.webviewRpc = null;
                this.webviewApi = null;
            });
        }
        if (loc !== null) { await this.webviewApi?.position(loc); }
        await this.sendConfig();
        await this.sendMessages();
    }

    private async sendMessages() {
        if (!this.webviewApi) return;
        const messages: Message[] = [];
        this.client.client.diagnostics?.forEach((uri, diags) => {
            for (const diag of diags) {
                messages.push({
                    uri: uri.toString(),
                    line: diag.range.start.line,
                    character: diag.range.start.character,
                    severity: diag.severity,
                    message: diag.message,
                });
            }
        });
        await this.webviewApi.messages(messages);
    }

    private async handleInsertText(text: string, type: string, loc?: InfoviewLocation) {
        let editor: TextEditor = null;
        if (loc) {
           editor = window.visibleTextEditors.find(e => e.document.uri.toString() === loc.uri);
        } else {
            editor = window.activeTextEditor;
            if (!editor) { // sometimes activeTextEditor is null.
                editor = window.visibleTextEditors[0];
            }
        }
        if (!editor) return;
        const pos = loc ? this.positionOfLocation(loc) : editor.selection.active;
        if (type === 'relative') {
            // in this case, assume that we actually want to insert at the same
            // indentation level as the neighboring text
            const prev_line = editor.document.lineAt(pos.line - 1);
            const spaces = prev_line.firstNonWhitespaceCharacterIndex;
            const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

            let new_command = text.replace(/\n/g, '\n' + margin_str);
            new_command = `\n${margin_str}${new_command}`;

            await editor.edit((builder) => {
                builder.insert(prev_line.range.end, new_command);
            });
            editor.selection = new Selection(pos.line, spaces, pos.line, spaces);
        } else {
            await editor.edit((builder) => {
                builder.insert(pos, text);
            });
            editor.selection = new Selection(pos, pos)
        }
    }

    private positionOfLocation(l: InfoviewLocation): Position {
        return new Position(l.line, l.character);
    }

    private makeLocation(uri: Uri, pos: Position): InfoviewLocation {
        return {
            uri: uri.toString(),
            line: pos.line,
            character: pos.character,
        }
    }

    private async sendConfig() {
        await this.webviewApi?.setConfig({
            infoViewTacticStateFilters: getInfoViewTacticStateFilters(),
            filterIndex: getInfoViewFilterIndex(),
            infoViewAllErrorsOnLine: getInfoViewAllErrorsOnLine(),
            infoViewAutoOpenShowGoal: getInfoViewAutoOpenShowGoal(),
        });
    }

    private async revealEditorPosition(uri: Uri, line: number, column: number) {
        const pos = new Position(line, column);
        let editor = null;
        for (const e of window.visibleTextEditors) {
            if (e.document.uri.toString() === uri.toString()) {
                editor = e;
                break;
            }
        }
        if (!editor) {
            const c = window.activeTextEditor ? window.activeTextEditor.viewColumn : ViewColumn.One;
            const td = await workspace.openTextDocument(uri);
            editor = await window.showTextDocument(td, c, false);
        }
        editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenterIfOutsideViewport);
        editor.selection = new Selection(pos, pos);
    }

    private async sendPosition() {
        const loc = this.getActiveCursorLocation();
        if (loc === null) { return; }
        await this.webviewApi?.position(loc);
    }

    private getActiveCursorLocation(): InfoviewLocation | null {
        if (!window.activeTextEditor || !languages.match(this.leanDocs, window.activeTextEditor.document)) {return null; }
        return this.makeLocation(window.activeTextEditor.document.uri, window.activeTextEditor.selection.active);
    }

    private getMediaPath(mediaFile: string): string {
        return this.webviewPanel.webview.asWebviewUri(
            Uri.file(join(this.context.extensionPath, 'media', mediaFile))).toString();
    }

    private initialHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>Infoview</title>
                <style>${this.stylesheet}</style>
            </head>
            <body>
                <div id="react_root"></div>
                <script src="${this.getMediaPath('index.js')}"></script>
            </body>
            </html>`
    }
}
