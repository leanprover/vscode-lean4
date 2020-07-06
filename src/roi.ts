import { CheckingMode, FileRoi, RoiRange } from 'lean-client-js-node';
import { commands, Disposable, DocumentFilter, EventEmitter, languages,
    QuickPickItem, window, workspace } from 'vscode';
import { Server } from './server';

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
            window.onDidChangeActiveTextEditor(() => this.send()),
            window.onDidChangeTextEditorSelection(() => this.send()),
            window.onDidChangeVisibleTextEditors(() => this.send()),
            window.onDidChangeTextEditorVisibleRanges(() => this.send()),
            workspace.onDidOpenTextDocument(() => this.send()),
            workspace.onDidCloseTextDocument(() => this.send()),
            server.restarted.on(() => this.send()),
        );

        switch (workspace.getConfiguration('lean').get('roiModeDefault')) {
            case 'nothing': this.mode = RoiMode.Nothing; break;
            case 'visible': this.mode = RoiMode.VisibleFiles; break;
            case 'lines': this.mode = RoiMode.VisibleLines; break;
            case 'linesAndAbove': this.mode = RoiMode.VisibleLinesAndAbove; break;
            case 'open': this.mode = RoiMode.OpenFiles; break;
            case 'project': this.mode = RoiMode.ProjectFiles; break;
            default: this.mode = RoiMode.VisibleLinesAndAbove;
        }
        void this.send();

        this.subscriptions.push(commands.registerCommand('lean.roiMode.select', async () => {
            const items: (QuickPickItem & {mode: RoiMode})[] = [
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
            const selected = await window.showQuickPick(items);
            if (selected) { await this.check(selected.mode); }
        }));
        this.subscriptions.push(commands.registerCommand('lean.roiMode.nothing',
            () => this.check(RoiMode.Nothing)));
        this.subscriptions.push(commands.registerCommand('lean.roiMode.visibleFiles',
            () => this.check(RoiMode.VisibleFiles)));
        this.subscriptions.push(commands.registerCommand('lean.roiMode.linesAndAbove',
            () => this.check(RoiMode.VisibleLinesAndAbove)));
        this.subscriptions.push(commands.registerCommand('lean.roiMode.openFiles',
            () => this.check(RoiMode.OpenFiles)));
        this.subscriptions.push(commands.registerCommand('lean.roiMode.projectFiles',
            () => this.check(RoiMode.ProjectFiles)));

    }

    async compute(): Promise<FileRoi[]> {
        let paths: string[];
        if (this.mode === RoiMode.ProjectFiles) {
            const files = await workspace.findFiles('**/*.lean');
            paths = files.map((f) => f.fsPath);
        } else {
            paths = workspace.textDocuments.filter((d) => languages.match(this.documentFilter, d))
                                           .map((d) => d.fileName);
        }

        const visibleRanges: {[fileName: string]: RoiRange[]} = {};
        for (const editor of window.visibleTextEditors) {
            if (languages.match(this.documentFilter, editor.document)) {
                visibleRanges[editor.document.fileName] =
                    editor.visibleRanges.map((r) => ({
                        begin_line: r.start.line + 1,
                        end_line: r.end.line + 1,
                    }));
            }
        }

        return paths.map((path) => ({file_name: path, ranges: visibleRanges[path] || []}));
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

    async send(): Promise<void> {
        const roi = await this.compute();
        await this.server.roi(this.modeString(), roi);
    }

    async check(mode: RoiMode): Promise<void> {
        this.mode = mode;
        this.modeChangedEmitter.fire(mode);
        await this.send();
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
