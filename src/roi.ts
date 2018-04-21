import {CheckingMode, FileRoi, RoiRange} from 'lean-client-js-node';
import * as vscode from 'vscode';
import { Disposable, DocumentFilter, Event, EventEmitter, QuickPickItem } from 'vscode';
import {Server} from './server';

export enum RoiMode {
    Nothing,
    VisibleFiles,
    VisibleLines,
    VisibleLinesAndAbove,
    OpenFiles,
    ProjectFiles,
}

export class RoiManager implements Disposable {
    mode: RoiMode;
    private modeChangedEmitter = new EventEmitter<RoiMode>();
    onModeChanged = this.modeChangedEmitter.event;
    private subscriptions: Disposable[] = [];

    constructor(private server: Server, private documentFilter: DocumentFilter) {
        this.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.send()),
            vscode.window.onDidChangeTextEditorSelection(() => this.send()),
            vscode.window.onDidChangeVisibleTextEditors(() => this.send()),
            vscode.window.onDidChangeTextEditorVisibleRanges(() => this.send()),
            vscode.workspace.onDidOpenTextDocument(() => this.send()),
            vscode.workspace.onDidCloseTextDocument(() => this.send()),
            server.restarted.on(() => this.send()),
        );

        switch (vscode.workspace.getConfiguration('lean').get('roiModeDefault')) {
            case 'nothing': this.mode = RoiMode.Nothing; break;
            case 'visible': this.mode = RoiMode.VisibleFiles; break;
            case 'lines': this.mode = RoiMode.VisibleLines; break;
            case 'linesAndAbove': this.mode = RoiMode.VisibleLinesAndAbove; break;
            case 'open': this.mode = RoiMode.OpenFiles; break;
            case 'project': this.mode = RoiMode.ProjectFiles; break;
            default: this.mode = RoiMode.VisibleLinesAndAbove;
        }
        this.send();

        this.subscriptions.push(vscode.commands.registerCommand('lean.roiMode.select', () => {
            const items: Array<QuickPickItem & {mode: RoiMode}> = [
                {
                    label: 'nothing',
                    description: 'disable checking',
                    mode: RoiMode.Nothing,
                },
                {
                    label: 'visible lines',
                    description: 'check lines that are currently visible',
                    mode: RoiMode.VisibleLines,
                },
                {
                    label: 'visible lines and above',
                    description: 'check visible lines and the file above it',
                    mode: RoiMode.VisibleLinesAndAbove,
                },
                {
                    label: 'visible files',
                    description: 'check files that are currently visible',
                    mode: RoiMode.VisibleFiles,
                },
                {
                    label: 'open files',
                    description: 'check files that are opened',
                    mode: RoiMode.OpenFiles,
                },
                {
                    label: 'project files',
                    description: 'check files that are in the current workspace',
                    mode: RoiMode.ProjectFiles,
                },
            ];
            vscode.window.showQuickPick(items).then((selected) =>
                selected && this.check(selected.mode));
        }));
        this.subscriptions.push(vscode.commands.registerCommand('lean.roiMode.nothing',
            () => this.check(RoiMode.Nothing)));
        this.subscriptions.push(vscode.commands.registerCommand('lean.roiMode.visibleFiles',
            () => this.check(RoiMode.VisibleFiles)));
        this.subscriptions.push(vscode.commands.registerCommand('lean.roiMode.openFiles',
            () => this.check(RoiMode.OpenFiles)));
        this.subscriptions.push(vscode.commands.registerCommand('lean.roiMode.projectFiles',
            () => this.check(RoiMode.ProjectFiles)));

    }

    compute(): Thenable<FileRoi[]> {
        const visibleRanges: {[fileName: string]: RoiRange[]} = {};
        for (const editor of vscode.window.visibleTextEditors) {
            if (vscode.languages.match(this.documentFilter, editor.document)) {
                visibleRanges[editor.document.fileName] =
                    editor.visibleRanges.map((r) => ({
                        begin_line: r.start.line + 1,
                        end_line: r.end.line + 1,
                    }));
            }
        }

        const roi: FileRoi[] = [];
        if (this.mode === RoiMode.ProjectFiles) {
            return vscode.workspace.findFiles('**/*.lean').then((files) => {
                for (const f of files) {
                    const path = f.fsPath;
                    roi.push({file_name: path, ranges: visibleRanges[path] || []});
                }
                return roi;
            });
        } else {
            for (const d of vscode.workspace.textDocuments) {
                const path = d.fileName;
                roi.push({file_name: path, ranges: visibleRanges[path] || []});
            }
            return Promise.resolve(roi);
        }
    }

    modeString(): CheckingMode {
        switch (this.mode) {
            case RoiMode.Nothing: return 'nothing';
            case RoiMode.VisibleFiles: return 'visible-files';
            case RoiMode.VisibleLines: return 'visible-lines';
            case RoiMode.VisibleLinesAndAbove: return 'visible-lines-and-above';
            case RoiMode.OpenFiles: return 'open-files';
            case RoiMode.ProjectFiles: return 'open-files';
            default: throw new Error('unknown roi mode');
        }
    }

    async send() {
        const roi = await this.compute();
        await this.server.roi(this.modeString(), roi);
    }

    check(mode: RoiMode) {
        this.mode = mode;
        this.modeChangedEmitter.fire(mode);
        this.send();
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
