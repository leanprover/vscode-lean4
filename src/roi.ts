import * as vscode from 'vscode';
import { Disposable, Event, EventEmitter, DocumentFilter } from 'vscode';
import {Server} from './server';
import {CheckingMode, FileRoi, RoiRange} from 'lean-client-js-node';

export enum RoiMode {
    Nothing,
    VisibleFiles,
    // VisibleLines, // TODO(gabriel): depends on https://github.com/Microsoft/vscode/issues/14756
    OpenFiles,
    ProjectFiles,
}

export class RoiManager implements Disposable {
    mode: RoiMode;
    private modeChangedEmitter = new EventEmitter<RoiMode>();
    onModeChanged = this.modeChangedEmitter.event;
    private subscriptions: Disposable[] = [];

    constructor(private server: Server, private documentFilter: DocumentFilter) {
        this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.send()));
        this.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => this.send()));
        this.subscriptions.push(vscode.workspace.onDidOpenTextDocument(() => this.send()));
        this.subscriptions.push(vscode.workspace.onDidCloseTextDocument(() => this.send()));
        this.subscriptions.push(server.restarted.on(() => this.send()));

        switch (vscode.workspace.getConfiguration('lean').get('roiModeDefault')) {
            case 'nothing': this.mode = RoiMode.Nothing; break;
            case 'visible': this.mode = RoiMode.VisibleFiles; break;
            case 'open': this.mode = RoiMode.OpenFiles; break;
            case 'project': this.mode = RoiMode.ProjectFiles; break;
            default: this.mode = RoiMode.VisibleFiles;
        }
        this.send();
    }

    compute(): Thenable<FileRoi[]> {
        // improve after https://github.com/Microsoft/vscode/issues/14756
        let visibleRanges: {[fileName: string]: RoiRange[]} = {};
        for (let editor of vscode.window.visibleTextEditors) {
            if (vscode.languages.match(this.documentFilter, editor.document)) {
                visibleRanges[editor.document.fileName] =
                    [{begin_line: 1, end_line: editor.document.lineCount}];
            }
        }

        let roi: FileRoi[] = [];
        if (this.mode == RoiMode.ProjectFiles) {
            return vscode.workspace.findFiles("**/*.lean").then(files => {
                for (let f of files) {
                    let path = f.fsPath;
                    if (visibleRanges[path]) {
                        roi.push({file_name: path, ranges: visibleRanges[path]});
                    } else {
                        roi.push({file_name: path, ranges: []});
                    }
                }
                return roi;
            });
        } else {
            for (let d of vscode.workspace.textDocuments) {
                let path = d.fileName;
                if (visibleRanges[path]) {
                    roi.push({file_name: path, ranges: visibleRanges[path]});
                } else {
                    roi.push({file_name: path, ranges: []});
                }
            }
            return Promise.resolve(roi);
        }
    }

    modeString(): CheckingMode {
        switch (this.mode) {
            case RoiMode.Nothing: return "nothing";
            case RoiMode.VisibleFiles: return "visible-files";
            case RoiMode.OpenFiles: return "open-files";
            case RoiMode.ProjectFiles: return "open-files";
            default: throw "unknown roi mode";
        }
    }

    send() { this.compute().then(roi => this.server.roi(this.modeString(), roi)) }

    check(mode: RoiMode) {
        this.mode = mode;
        this.modeChangedEmitter.fire(mode);
        this.send();
    }

    dispose() {
        for (const s of this.subscriptions) s.dispose();
    }
}