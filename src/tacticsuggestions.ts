import { commands, Disposable,  window, TextEditor, TextEditorEdit, Position, Range } from 'vscode';
import { Server } from './server';
import { Message } from 'lean-client-js-node';

/** Pastes suggestions provided by tactics such as `squeeze_simp` */
export class TacticSuggestions implements Disposable {
    private subscriptions: Disposable[] = [];
    constructor(private server: Server) {
        const command = 'lean.pasteTacticSuggestion';

        const commandHandler = (textEditor : TextEditor, edit : TextEditorEdit) => {
            const curFileName = textEditor.document.fileName;
            const curPosition = textEditor.selection.active;
            // Find message closest to the cursor
            const messages = this.server.messages
                .filter((m : Message) => m.file_name === curFileName &&
                    m.pos_line === curPosition.line + 1 &&
                    m.pos_col <= curPosition.character)
                .sort((a, b) => b.pos_col - a.pos_col);

            if (messages.length === 0) return;

            const msg = messages[0];
            const suggestion = msg.text.match(/Try this: ?(.*)/)[1];

            if (!suggestion) return;

            // Replace everything from the message start till the end of line
            const range = new Range(
                new Position(curPosition.line, msg.pos_col),
                new Position(curPosition.line, 
                    textEditor.document.lineAt(curPosition.line).range.end.character)
            )
            edit.replace(range, suggestion);
        };

        this.subscriptions.push(
            commands.registerTextEditorCommand(command, commandHandler)
        );
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}