import {
    Disposable, TextEditor, EventEmitter, TextDocumentChangeEvent, TextDocumentContentChangeEvent
} from 'vscode';

import { integer, uinteger, Range, Location, DidCloseTextDocumentParams } from 'vscode-languageserver-protocol';
import * as ls from 'vscode-languageserver-protocol';

export class Bookmark {
    id: integer;
    uri: string;
    line: uinteger;
    character: uinteger;
    valid: boolean;

    constructor(id: integer, uri: string, line: integer, character: uinteger) {
        this.id = id;
        this.uri = uri;
        this.line = line;
        this.character = character;
        this.valid = true;
    }

    /**
     * Adjusts this bookmark according to the given replace operation and returns false
     * if the bookmark was unmodified, otherwise true.  This can also invalidate the bookmark
     * if the bookmark is inside the replaced range, and in this case the bookmark
     * valid field is set to false.
     */
    replace(r: Range, originalText: string, newText: string) : boolean{
        if (r.start.line > this.line || (r.start.line === this.line && r.start.character >= this.character)) {
            return false; // nothing to do, the edit starts after this bookmark position.
        }

        // we know the delete starts before this bookmark.
        if (r.end.line < this.line || (r.end.line === this.line && r.end.character < this.character)) {
            // the edit ends before this bookmark position, so the bookmark is still valid, but
            // what are we replacing?  If the text that was replaced contains newlines then we need
            // to remove that many newlines in our bookmark position then add the number of newlines
            // in the newText.
            const lineDelta = this.countLines(newText) - this.countLines(originalText);
            let charDelta = 0;

            if (r.end.line === this.line){
                // we may also need to ajust the bookmark character position since our line was also modified.
                const newChar = (this.character - r.end.character) + this.lastLine(newText).length;
                charDelta = newChar - this.character;
            }
            this.line += lineDelta;
            this.character += charDelta;
            return lineDelta !== 0 || charDelta !== 0;
        }

        // the end of the replaced text is after this bookmark and the start is before, so this bookmark
        // just got invalidated!
        this.valid = false;
        return true;
    }

    private countLines(s: string){
        let pos = s.indexOf('\n');
        let count = 0;
        while (pos >= 0){
            count++;
            pos = s.indexOf('\n', pos + 1);
        }
        return count;
    }

    private lastLine(s: string){
        let pos = s.length;
        while (pos > 0){
            pos--;
            if (s[pos] === '\n'){
                return s.substring(pos + 1);
            }
        }
        return s;
    }
}

export class Bookmarks implements Disposable
{
    private bookmarks: Bookmark[];
    private nextId: integer = 0;

    private changedEmitter = new EventEmitter<Bookmark[]>();
    changed = this.changedEmitter.event

    private removedEmitter = new EventEmitter<Bookmark[]>();
    removed = this.removedEmitter.event

    private originalText : Map<string,string> = new Map();

    constructor() {
        this.bookmarks= [];
    }

    addBookmark(editor: TextEditor) : Bookmark {
        const uri = editor.document.uri;
        const selection = editor.selection;
        const loc : Location = {
            uri: uri.toString(),
            range: {
                start: selection.start,
                end: selection.end
            }
        };

        // bugbug: why doesn't vscode give us this snapshot management?
        // See https://github.com/microsoft/vscode/issues/153054
        this.originalText.set(uri.toString(), editor.document.getText());

        const bm = new Bookmark(this.nextId, loc.uri, loc.range.end.line, loc.range.end.character);
        this.bookmarks.push(bm);
        this.nextId++;
        return bm;
    }

    onChange(change: TextDocumentChangeEvent){
        const uri = change.document.uri.toString();
        const documentLocal = this.bookmarks.filter(i => i.uri === uri);
        if (documentLocal.length === 0){
            // no bookmarks in this file so nothing to update!
            return;
        }
        const modified : Bookmark[] = [];
        const removed :  Bookmark[] = [];
        for (const e of change.contentChanges){
            if (ls.TextDocumentContentChangeEvent.isIncremental(e)) {
                const range = e.range;
                const text = e.text;
                // if range is non-empty then it is replacing the range with "text".
                // and this "replace" operation could have encompassed a bookmark in which case we
                // probably should delete it.
                for (const bm of documentLocal){
                    // BUGBUG: See https://github.com/microsoft/vscode/issues/153054
                    let before = '';
                    if (!range.isEmpty && this.originalText.has(uri)){
                        const original = this.originalText.get(uri);
                        if (original) {
                            before = original.slice(e.rangeOffset, e.rangeOffset+e.rangeLength);
                        }
                    }
                    if (bm.replace(range, before, text)){
                        if (!bm.valid){
                            if (removed.indexOf(bm) < 0){
                                removed.push(bm);
                            }
                        } else if (modified.indexOf(bm) < 0){
                            modified.push(bm);
                        }
                    }
                }
            } else if (ls.TextDocumentContentChangeEvent.isFull(e)){
                // full replacement of the document blows away all bookmarks then since we have no way to
                // know how the new text compares to what was there before.
                for (const bm of this.bookmarks.filter(i => i.uri === uri)){
                    if (removed.indexOf(bm) < 0){
                        removed.push(bm);
                    }
                }
            }
        }

        // now apply changes to our originalText snapshots!
        // Note the contentChanges are already in reverse order so we can apply them incrementally like this.
        for (const e of change.contentChanges){
            if (ls.TextDocumentContentChangeEvent.isIncremental(e)) {
                const text = e.text;
                if (this.originalText.has(uri)){
                    const original = this.originalText.get(uri);
                    if (original) {
                        const newBuffer = original.slice(0, e.rangeOffset) + text + original.slice(e.rangeOffset + e.rangeLength);
                        this.originalText.set(uri, newBuffer);
                    }
                }
            }else if (ls.TextDocumentContentChangeEvent.isFull(e)){
                if (this.originalText.has(uri)){
                    this.originalText.delete(uri);
                }
            }
        }

        if (modified.length > 0){
            this.onChanged(modified);
        }
        if (removed.length > 0){
            this.remove(removed);
        }
    }

    private remove(removed: Bookmark[]){
        this.onRemoved(removed);
        this.bookmarks = this.bookmarks.filter(i => removed.indexOf(i) >= 0);
    }

    onClosed(closed: DidCloseTextDocumentParams){
        this.remove(this.bookmarks.filter(i => i.uri === closed.textDocument.uri));
    }

    dispose(): void {
        this.remove(this.bookmarks);
    }

    private onChanged(changes: Bookmark[]){
        this.changedEmitter.fire(changes);
    }

    private onRemoved(removed: Bookmark[]){
        this.removedEmitter.fire(removed);
    }
}
