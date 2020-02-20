import { commands, Disposable,  window, TextEditor, TextEditorEdit,
    Position, Range, Uri, Selection } from 'vscode';
import { Server } from './server';
import { Message } from 'lean-client-js-node';
import { InfoProvider } from './infoview';

/** Pastes suggestions provided by tactics such as `squeeze_simp` */
export class TacticSuggestions implements Disposable {
    private subscriptions: Disposable[] = [];

    // Match everything after "Try this" until the next unindented line
    private magicWord = 'Try this: ';
    private regex = '^' + this.magicWord + '((.*\n )*.*)$';

    constructor(private server: Server, private infoView: InfoProvider) {

        const commandHandler = (textEditor : TextEditor, edit : TextEditorEdit) => {
            const msg = this.findSelectedMessage(textEditor);
            if (msg === null) return;

            this.pasteIntoEditor(msg, textEditor, null);
        };

        const infoViewCommandHandler = (m : Message, suggestion : string) => {
            const textEditor = this.findTextEditor(m.file_name);

            this.pasteIntoEditor(m, textEditor, suggestion);

            // Focus text editor
            window.showTextDocument(textEditor.document, {viewColumn:textEditor.viewColumn});
        };

        this.subscriptions.push(
            commands.registerTextEditorCommand('lean.pasteTacticSuggestion', commandHandler),
            commands.registerCommand('_lean.pasteTacticSuggestion', infoViewCommandHandler)
        );

        infoView.addMessageFormatter((text: string, m : Message) => {
            const newText = text.replace(new RegExp(this.regex, 'mg'), (match,tactic) => {
                const command = encodeURI('command:_lean.pasteTacticSuggestion?' +
                    JSON.stringify([m, tactic]));
                return `${this.magicWord}<a href="${command}" title="${tactic}">${tactic}</a>`
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

    private async pasteIntoEditor(m : Message, textEditor : TextEditor, suggestion : string | null){
        if (suggestion === null) {
            // Find first suggestion in message
            suggestion = m.text.match(new RegExp(this.regex, 'm'))[1];
            if (!suggestion) return;
        }

        // Start of the tactic call to replace
        const startLine = m.pos_line - 1;
        const startCol = m.pos_col;

        // Try to determine the end of the tactic call to replace.
        // Heuristic: Find the next comma, semicolon, unmatched closing bracket,
        // or newline that is not enclosed in brackets. To keep things simple,
        // we use only one counter for all kinds of brackets.
        let openBrackets = 0;
        let endLine: number;
        let endCol: number;
        lineLoop:
        for (endLine = startLine; endLine < textEditor.document.lineCount; endLine++) {
            const chars = textEditor.document.lineAt(endLine).text.split('').entries();
            // Iterate over every character of the line
            for(const [col, char] of chars){
                // Only search from where the tactic starts
                if (endLine > startLine || col > startCol) {
                    if (openBrackets === 0 && [',',';'].includes(char)) {
                        endCol = col;
                        break lineLoop;
                    }
                    if (['(','[','{','⟨','⦃'].includes(char)) {
                        openBrackets++;
                    }
                    if (['⦄','⟩','}',']',')'].includes(char)) {
                        if (openBrackets === 0) {
                            endCol = col;
                            break lineLoop;
                        } else {
                            openBrackets--;
                        }
                    }
                }
            }
            if (openBrackets === 0) {
                endCol = textEditor.document.lineAt(endLine).range.end.character;
                break lineLoop;
            }
        }

        // Jump to the end of the tactic call
        const lastPos = new Position(endLine, endCol)
        textEditor.selection = new Selection(lastPos,lastPos)

        // Replace tactic call by suggestion
        const range = new Range(
            new Position(startLine, startCol),
            new Position(endLine, endCol)
        )
        await textEditor.edit(editBuilder => {
            editBuilder.replace(range, suggestion)
        });

        // Strangely, the cursor moves during the edit, but the selection anchor
        // does not. Therefore, move the anchor to the cursor:
        textEditor.selection =
            new Selection(textEditor.selection.active, textEditor.selection.active);
    }
}