import * as React from 'react';
import { DidChangeTextDocumentParams, DidCloseTextDocumentParams, Location, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';

import { EditorContext } from './contexts';
import { DocumentPosition, Keyed, PositionHelpers, useClientNotificationEffect, useClientNotificationState, useEvent } from './util';
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
                    if (!PositionHelpers.isAfterOrEqual(pin, chg.range.start)) continue;

                    let lines = 0;
                    for (const c of chg.text) if (c === '\n') lines++;
                    newPin.line = chg.range.start.line + Math.max(0, newPin.line - chg.range.end.line) + lines;
                    newPin.character = newPin.line > chg.range.end.line ?
                        newPin.character :
                        lines === 0 ?
                            chg.range.start.character + Math.max(0, newPin.character - chg.range.end.character) + chg.text.length :
                            9999;
                }
                // TODO use a valid position instead of 9999
                //newPosition = e.document.validatePosition(newPosition);
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

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [curLoc, setCurLoc] = React.useState<Location>(ec.events.changedCursorLocation.current!);
    useEvent(ec.events.changedCursorLocation, loc => loc && setCurLoc(loc), []);

    const curPos: DocumentPosition = { uri: curLoc.uri, ...curLoc.range.start };

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
        if (act.kind !== 'togglePin') return;
        setPinnedPoss(pinnedPoss => {
            if (isPinned(pinnedPoss, curPos)) {
                return pinnedPoss.filter(p => !DocumentPosition.isEqual(p, curPos));
            } else {
                pinKey.current += 1;
                return [ ...pinnedPoss, { ...curPos, key: pinKey.current.toString() } ];
            }
        });
    }, [curPos.uri, curPos.line, curPos.character]);

    const infoProps: Keyed<InfoProps>[] = pinnedPoss.map(pos => ({ kind: 'pin', onPin: unpin, pos, key: pos.key }));
    infoProps.push({ kind: 'cursor', onPin: pin, key: 'cursor' });

    return <div> {infoProps.map (ps => <Info {...ps} />)} </div>;
}
