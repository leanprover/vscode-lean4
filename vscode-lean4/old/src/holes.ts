import { HoleCommands, HoleResponse } from 'lean-client-js-core';
import { CodeActionProvider, Command, commands, Diagnostic,
    DiagnosticCollection, DiagnosticSeverity, Disposable, DocumentSelector, languages,
    Range, TextDocument, Uri, window } from 'vscode';
import { Server } from './server';

interface Pos { line: number; column: number }
interface Ran { start: Pos; end: Pos }
function mkRange(r: Ran): Range {
    return new Range(r.start.line - 1, r.start.column, r.end.line - 1, r.end.column);
}

export class LeanHoles implements Disposable, CodeActionProvider {
    private holes: HoleCommands[] = [];
    private collection: DiagnosticCollection;
    private subscriptions: Disposable[] = [];

    private executeHoleCommand = 'lean.executeHole';

    constructor(private server: Server, private leanDocs: DocumentSelector) {
        this.subscriptions.push(
            this.collection = languages.createDiagnosticCollection('lean holes'),
            commands.registerCommand(this.executeHoleCommand, (file, line, column, action) =>
                this.execute(file, line, column, action)),
            languages.registerCodeActionsProvider(this.leanDocs, this),
            window.onDidChangeVisibleTextEditors(() => this.refresh()),
            this.server.statusChanged.on(() => this.refresh()),
        );
    }

    private async refresh() {
        const ress = await Promise.all(window.visibleTextEditors
            .filter((editor) => languages.match(this.leanDocs, editor.document))
            .map((editor) => this.server.allHoleCommands(editor.document.fileName)));

        this.holes = [];
        for (const res of ress) {
            [].push.apply(this.holes, res.holes);
        }

        const holesPerFile = new Map<string, HoleCommands[]>();
        for (const hole of this.holes) {
            if (!holesPerFile.get(hole.file)) { holesPerFile.set(hole.file, []); }
            holesPerFile.get(hole.file).push(hole);
        }

        this.collection.clear();
        for (const file of holesPerFile.keys()) {
            this.collection.set(Uri.file(file),
                holesPerFile.get(file).map((hole) =>
                    new Diagnostic(mkRange(hole),
                        'Hole: ' + hole.results.map((a) => a.name).join('/'),
                        DiagnosticSeverity.Hint)));
        }
    }

    private async execute(file: string, line: number, column: number, action: string) {
        let res: HoleResponse;
        try {
            res = await this.server.hole(file, line, column, action);
        } catch (e) {
            return window.showErrorMessage(`Error while executing hole command: ${e}`);
        }

        if (res.message) {
            void window.showInformationMessage(res.message);
        }
        if (res.replacements && res.replacements.alternatives) {
            // TODO(gabriel): ask user if more than one alternative
            for (const editor of window.visibleTextEditors) {
                if (editor.document.fileName === file) {
                    await editor.edit((builder) => {
                        builder.replace(mkRange(res.replacements),
                            res.replacements.alternatives[0].code);
                    });
                }
            }
        }
    }

    provideCodeActions(document: TextDocument, range: Range): Command[] {
        const cmds: Command[] = [];
        for (const hole of this.holes) {
            if (!range.intersection(mkRange(hole))) { continue; }
            for (const action of hole.results) {
                cmds.push({
                    title: action.description,
                    command: this.executeHoleCommand,
                    arguments: [hole.file, hole.start.line, hole.start.column, action.name],
                });
            }
        }
        return cmds;
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
