import { commands, Disposable,  window, TextEditor, TextEditorEdit, Position, Range, Uri } from 'vscode';
import { Server } from './server';
import { Message } from 'lean-client-js-node';
import { InfoProvider } from './infoview';

/** Pastes suggestions provided by tactics such as `squeeze_simp` */
export class TacticSuggestions implements Disposable {
    private subscriptions: Disposable[] = [];
    private magicWord = 'Try this: ';
    private regex = '^' + this.magicWord + '(.*)$';

    constructor(private server: Server, private infoView: InfoProvider) {

        const commandHandler = (textEditor : TextEditor, edit : TextEditorEdit) => {
            const msg = this.findSelectedMessage(textEditor);
            if (msg === null) return;

            this.pasteIntoEditor(msg, textEditor, null);
        };

        const infoViewCommandHandler = (m : Message, suggestion : string) => {
            const textEditor = this.findTextEditor(m.file_name);
            this.pasteIntoEditor(m, textEditor, suggestion);
        };

        this.subscriptions.push(
            commands.registerTextEditorCommand('lean.pasteTacticSuggestion', commandHandler),
            commands.registerCommand('_lean.pasteTacticSuggestion', infoViewCommandHandler)
        );

        infoView.addMessageFormatter((text: string, m : Message) => {
            const newText = text.replace(new RegExp(this.regex, 'mg'), (match,tactic) => {
                const command = encodeURI('command:_lean.pasteTacticSuggestion?' +
                    JSON.stringify([m, tactic]));
                return `${this.magicWord}<a href="${command}">${tactic}</a>`
            });
            return newText;
        });
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private findTextEditor(fileName){
        for (const textEditor of window.visibleTextEditors) {
            if (textEditor.document.uri.toString() === Uri.file(fileName).toString()) {
                return textEditor;
            }
        }
    }

    private findSelectedMessage(textEditor : TextEditor){
        const curFileName = textEditor.document.fileName;
        const curPosition = textEditor.selection.active;
        // Find message closest to the cursor
        const messages = this.server.messages
            .filter((m : Message) => m.file_name === curFileName &&
                m.pos_line === curPosition.line + 1 &&
                m.pos_col <= curPosition.character)
            .sort((a, b) => b.pos_col - a.pos_col);

        if (messages.length === 0) return null;

        return messages[0];
    }

    private pasteIntoEditor(m : Message, textEditor : TextEditor, suggestion : string | null){
        if (suggestion === null) {
            // Find first suggestion in message
            suggestion = m.text.match(new RegExp(this.regex, 'm'))[1];
            if (!suggestion) return;
        }

        const line = m.pos_line - 1;
        const col = m.pos_col;

        // Replace everything from the message start till the end of line
        const range = new Range(
            new Position(line, col),
            new Position(line,
                textEditor.document.lineAt(line).range.end.character)
        )
        textEditor.edit(editBuilder => {
            editBuilder.replace(range, suggestion)
        });
    }
}