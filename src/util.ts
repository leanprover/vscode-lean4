import {TextDocument, Position} from 'vscode';

export function identifierStart(document : TextDocument, position : Position) : Position {
    let wordRange = document.getWordRangeAtPosition(position);
    return wordRange.start;
}