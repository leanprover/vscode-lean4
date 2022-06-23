import { RangeHelpers } from '@lean4/infoview/dist/infoview/util';
import {
    Disposable, TextEditor
} from 'vscode';

import * as ls from 'vscode-languageserver-protocol'

export class Bookmarks implements Disposable
{
    stickyPositions: ls.Location[];

    constructor() {
        this.stickyPositions= [];
    }

    addBookmark(editor: TextEditor) : void {
        if (!editor) return;
        const uri = editor.document.uri;
        const selection = editor.selection;
        const loc : ls.Location = {
            uri: uri.toString(),
            range: {
                start: selection.start,
                end: selection.end
            }
        };

        this.stickyPositions.push(loc);
    }

    pretty(text: string){
        return text.replace('\n', '\\n').replace('\r','\\r')
    }

    onChange(change: ls.DidChangeTextDocumentParams){
        const uri = change.textDocument.uri;
        for (const loc of this.stickyPositions){
            if (loc.uri === uri){
                for (const e of change.contentChanges){
                    if (ls.TextDocumentContentChangeEvent.isIncremental(e)) {
                        const range = e.range;
                        const text = this.pretty(e.text);
                        const end = range.end;
                        const start = range.start;
                        if (text === ''){
                            console.log(`delete from ${start.line},${start.character} to ${end.line},${end.character}`)
                        } else if (start.line === end.line && start.character === end.character) {
                            // this is a pure insert
                            console.log(`insert at ${start.line},${start.character} to ${end.line},${end.character}: ${text}`)
                        } else {
                            // if range is non-empty then it is replacing the range with "text".
                            // and this "replace" operation could have encompassed a pin in which case we
                            // probably should delete that pin.
                            console.log(`replace ${start.line},${start.character} to ${end.line},${end.character} with ${text}`)
                        }
                    } else if (ls.TextDocumentContentChangeEvent.isFull(e)){
                        // full replacement of the document kind of blows away all pins then!
                        const text = e.text;
                        console.log('full replace')
                    }
                }
            }
        }
    }

    onClosed(closed: ls.DidCloseTextDocumentParams){
        this.stickyPositions = this.stickyPositions.filter(i => i.uri !== closed.textDocument.uri);
    }

    dispose(): void {
        this.stickyPositions = [];
    }
}
