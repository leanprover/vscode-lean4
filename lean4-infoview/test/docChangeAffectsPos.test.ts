import { describe, expect, it } from 'vitest'
import type { DidChangeTextDocumentParams } from 'vscode-languageserver-protocol'
import { docChangeAffectsPos, type DocumentPosition } from '../src/infoview/util'

const uri = 'file:///test.lean'
const pos: DocumentPosition = { uri, line: 5, character: 10 }

function change(
    uri_: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
    text = 'x',
): DidChangeTextDocumentParams {
    return {
        textDocument: { uri: uri_, version: 1 },
        contentChanges: [{ range, rangeLength: 0, text }],
    }
}

describe('docChangeAffectsPos', () => {
    it('counts an edit on an earlier line (code action above the cursor)', () => {
        expect(
            docChangeAffectsPos(pos, change(uri, { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } })),
        ).toBe(true)
    })

    it('counts an edit starting before the cursor on the same line', () => {
        expect(
            docChangeAffectsPos(pos, change(uri, { start: { line: 5, character: 4 }, end: { line: 5, character: 5 } })),
        ).toBe(true)
    })

    it('counts an edit starting exactly at the cursor', () => {
        expect(
            docChangeAffectsPos(
                pos,
                change(uri, { start: { line: 5, character: 10 }, end: { line: 5, character: 10 } }),
            ),
        ).toBe(true)
    })

    it('ignores an edit starting after the cursor', () => {
        expect(
            docChangeAffectsPos(
                pos,
                change(uri, { start: { line: 5, character: 11 }, end: { line: 5, character: 12 } }),
            ),
        ).toBe(false)
        expect(
            docChangeAffectsPos(pos, change(uri, { start: { line: 6, character: 0 }, end: { line: 6, character: 1 } })),
        ).toBe(false)
    })

    it('ignores edits in another file', () => {
        expect(
            docChangeAffectsPos(
                pos,
                change('file:///other.lean', { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }),
            ),
        ).toBe(false)
    })

    it('counts a non-incremental (full-sync) change in the same file', () => {
        expect(
            docChangeAffectsPos(pos, {
                textDocument: { uri, version: 2 },
                contentChanges: [{ text: 'whole new file contents' }],
            }),
        ).toBe(true)
    })

    it('counts when any of several changes is at or before the cursor', () => {
        expect(
            docChangeAffectsPos(pos, {
                textDocument: { uri, version: 1 },
                contentChanges: [
                    {
                        range: { start: { line: 7, character: 0 }, end: { line: 7, character: 1 } },
                        rangeLength: 0,
                        text: 'x',
                    },
                    {
                        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
                        rangeLength: 0,
                        text: 'y',
                    },
                ],
            }),
        ).toBe(true)
    })
})
