import * as React from "react";
import { DidChangeTextDocumentParams, DidCloseTextDocumentParams, Location, TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";

import { EditorContext } from "./contexts";
import { addUniqueKeys, DocumentPosition, PositionHelpers, useClientNotificationEffect, useClientNotificationState, useEvent } from "./util";
import { Info, InfoProps } from "./info";

/** Manages and displays pinned infos, as well as info for the current location. */
export function Infos() {
    const ec = React.useContext(EditorContext);

    // Update pins when the document changes. In particular, when edits are made
    // earlier in the text such that a pin has to move up or down.
    const [pinnedPoss, setPinnedPoss] = useClientNotificationState(
        'textDocument/didChange',
        new Array<DocumentPosition>(),
        (pinnedPoss, params: DidChangeTextDocumentParams) => {
            if (pinnedPoss.length === 0) return pinnedPoss;

            let changed: boolean = false;
            const newPins = pinnedPoss.map(pin => {
                if (pin.uri !== params.textDocument.uri) return pin;

                let newPin = pin;
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
                return newPin;
            });

            if (changed) return newPins.filter(p => p !== null) as DocumentPosition[];
            return pinnedPoss;
        },
        []
    );

    // Remove pins for closed douments
    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => {
            setPinnedPoss(pinnedPoss => pinnedPoss.filter(p => p.uri !== params.textDocument.uri));
        },
        []
    );

    const [curLoc, setCurLoc] = React.useState<Location>(ec.events.changedCursorLocation.current!);
    useEvent(ec.events.changedCursorLocation, setCurLoc, []);

    const curPos: DocumentPosition = { uri: curLoc.uri, ...curLoc.range.start };

    // Update pins on UI actions
    const isPinned = (pinnedPoss: DocumentPosition[], pos: DocumentPosition) => {
        return pinnedPoss.some(p => DocumentPosition.isEqual(p, pos));
    }
    const pin = React.useCallback((pos: DocumentPosition) => {
        setPinnedPoss(pinnedPoss => {
            if (isPinned(pinnedPoss, pos)) return pinnedPoss;
            return [ ...pinnedPoss, pos ];
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
        setPinnedPoss(pinnedPoss =>
            isPinned(pinnedPoss, curPos) ?
                pinnedPoss.filter(p => !DocumentPosition.isEqual(p, curPos)) :
                [ ...pinnedPoss, curPos ]
        );
    }, [curPos.uri, curPos.line, curPos.character]);

    let infoProps: InfoProps[] = pinnedPoss.map(pos => { return { kind: 'pin', onPin: unpin, pos }; });
    infoProps.push({ kind: 'cursor', onPin: pin });
    infoProps = addUniqueKeys(infoProps, i => i.pos ? DocumentPosition.toString(i.pos) : 'cursor');

    return <div> {infoProps.map (ps => <Info {...ps} />)} </div>;
}