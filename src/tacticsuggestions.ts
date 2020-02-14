import { commands, Disposable,  window, TextEditor, TextEditorEdit } from 'vscode';
import { Server } from './server';

/** Pastes suggestions provided by tactics such as `squeeze_simp` */
export class TacticSuggestions implements Disposable {
    private subscriptions: Disposable[] = [];
    constructor(private server: Server) {
        const command = 'lean.pasteTacticSuggestion';

        const commandHandler = (textEditor : TextEditor, edit : TextEditorEdit) => {
            const curFileName = textEditor.document.fileName;
            const curPosition = textEditor.selection.active;
            const curSelection = textEditor.selection;
            const messages = this.server.messages
                .filter((m) => m.file_name === curFileName &&
                    m.pos_line === curPosition.line + 1)
                .sort((a, b) => a.pos_col - b.pos_col);

            if (messages.length > 0) {
                edit.replace(curSelection, messages[0].text);
            }
        };

        this.subscriptions.push(
            commands.registerTextEditorCommand(command, commandHandler)
        );
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}