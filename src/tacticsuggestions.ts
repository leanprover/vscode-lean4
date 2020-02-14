import { commands, Disposable,  window } from 'vscode';
import { Server } from './server';

/** Pastes suggestions provided by tactics such as `squeeze_simp` */
export class TacticSuggestions implements Disposable {
    private subscriptions: Disposable[] = [];
    constructor(private server: Server) {
        const command = 'lean.pasteTacticSuggestion';

        const commandHandler = (name: string = 'world') => {
            const editor = window.activeTextEditor;

            if (editor) {
                const curFileName = editor.document.fileName;
                const curPosition = editor.selection.active;
                const curSelection = editor.selection;
                const messages = this.server.messages
                    .filter((m) => m.file_name === curFileName &&
                        m.pos_line === curPosition.line + 1)
                    .sort((a, b) => a.pos_col - b.pos_col);
                // console.log(messages)
                if (messages.length > 0) {
                    editor.edit(editBuilder => {
                        editBuilder.replace(curSelection, messages[0].text);
                    });
                }
            }
        };

        this.subscriptions.push(
            commands.registerCommand(command, commandHandler)
        );
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}