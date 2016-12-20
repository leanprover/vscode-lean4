import {TextDocument, Position} from 'vscode';

export function identifierStart(document : TextDocument, position : Position) : Position {
    let wordRange = document.getWordRangeAtPosition(position);
    // If we can't match the start of a word, we should just return the original point.
    //
    // The server will then return a null-record and the hover won't be displayed.
    if (wordRange === undefined) {
        return position;
    } else {
        return wordRange.start;
    }
}