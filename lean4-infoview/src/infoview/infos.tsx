import * as React from 'react';
import { DidChangeTextDocumentParams, DidCloseTextDocumentParams, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';

import { EditorContext } from './contexts';
import { DocumentPosition, Keyed, PositionHelpers, useClientNotificationEffect, useClientNotificationState, useEvent, useEventResult } from './util';
import { Info, InfoProps } from './info';

/** Manages and displays pinned infos, as well as info for the current location. */
export function Infos() {
    const ec = React.useContext(EditorContext);

    // Update pins when the document changes. In particular, when edits are made
    // earlier in the text such that a pin has to move up or down.
    const [pinnedPoss, setPinnedPoss] = useClientNotificationState(
        'textDocument/didChange',
        new Array<Keyed<DocumentPosition>>(),
        (pinnedPoss, params: DidChangeTextDocumentParams) => {
            if (pinnedPoss.length === 0) return pinnedPoss;

            let changed: boolean = false;
            const newPins = pinnedPoss.map(pin => {
                if (pin.uri !== params.textDocument.uri) return pin;
                // NOTE(WN): It's important to make a clone here, otherwise this
                // actually mutates the pin. React state updates must be pure.
                // See https://github.com/facebook/react/issues/12856
                const newPin: Keyed<DocumentPosition> = { ...pin };
                for (const chg of params.contentChanges) {
                    if (!TextDocumentContentChangeEvent.isIncremental(chg)) {
                        changed = true;
                        return null;
                    }
                    if (PositionHelpers.isLessThanOrEqual(newPin, chg.range.start)) continue;
                    // We can assume chg.range.start < pin

                    // If the pinned position is replaced with new text, just delete the pin.
                    if (PositionHelpers.isLessThanOrEqual(newPin, chg.range.end)) {
                        changed = true;
                        return null;
                    }

                    const oldPin = { ...newPin };

                    // How many lines before the pin position were added by the change.
                    // Can be negative when more lines are removed than added.
                    let additionalLines = 0;
                    let lastLineLen = chg.range.start.character;
                    for (const c of chg.text)
                        if (c === '\n') {
                            additionalLines++;
                            lastLineLen = 0;
                        } else lastLineLen++;

                    // Subtract lines that were already present
                    additionalLines -= (chg.range.end.line - chg.range.start.line)
                    newPin.line += additionalLines;

                    if (oldPin.line < chg.range.end.line) {
                        // Should never execute by the <= check above.
                        throw new Error('unreachable code reached')
                    } else if (oldPin.line === chg.range.end.line) {
                        newPin.character = lastLineLen + (oldPin.character - chg.range.end.character);
                    }
                }
                if (!DocumentPosition.isEqual(newPin, pin)) changed = true;

                // NOTE(WN): We maintain the `key` when a pin is moved around to maintain
                // its component identity and minimise flickering.
                return newPin;
            });

            if (changed) return newPins.filter(p => p !== null) as Keyed<DocumentPosition>[];
            return pinnedPoss;
        },
        []
    );

    // Remove pins for closed documents
    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => {
            setPinnedPoss(pinnedPoss => pinnedPoss.filter(p => p.uri !== params.textDocument.uri));
        },
        []
    );

    const curLoc = useEventResult(ec.events.changedCursorLocation)
    const curPos: DocumentPosition | undefined = curLoc ? { uri: curLoc.uri, ...curLoc.range.start } : undefined

    // Update pins on UI actions
    const pinKey = React.useRef<number>(0);
    const isPinned = (pinnedPoss: DocumentPosition[], pos: DocumentPosition) => {
        return pinnedPoss.some(p => DocumentPosition.isEqual(p, pos));
    }
    const pin = React.useCallback((pos: DocumentPosition) => {
        setPinnedPoss(pinnedPoss => {
            if (isPinned(pinnedPoss, pos)) return pinnedPoss;
            pinKey.current += 1;
            return [ ...pinnedPoss, { ...pos, key: pinKey.current.toString() } ];
        });
    }, []);
    const unpin = React.useCallback((pos: DocumentPosition) => {
        setPinnedPoss(pinnedPoss => {
            if (!isPinned(pinnedPoss, pos)) return pinnedPoss;
            return pinnedPoss.filter(p => !DocumentPosition.isEqual(p, pos));
        });
    }, []);

    // Toggle pin at current position when the editor requests it
    useEvent(ec.events.requestedAction, act => {
        if (act.kind !== 'togglePin') return
        if (!curPos) return
        setPinnedPoss(pinnedPoss => {
            if (isPinned(pinnedPoss, curPos)) {
                return pinnedPoss.filter(p => !DocumentPosition.isEqual(p, curPos));
            } else {
                pinKey.current += 1;
                return [ ...pinnedPoss, { ...curPos, key: pinKey.current.toString() } ];
            }
        });
    }, [curPos?.uri, curPos?.line, curPos?.character]);

    const infoProps: Keyed<InfoProps>[] = pinnedPoss.map(pos => ({ kind: 'pin', onPin: unpin, pos, key: pos.key }));
    if (curPos) infoProps.push({ kind: 'cursor', onPin: pin, key: 'cursor' });

    return <div>
        {infoProps.map (ps => <Info {...ps} />)}
        {!curPos && <p>Click somewhere in the Lean file to enable the infoview.</p> }
    </div>;
}
