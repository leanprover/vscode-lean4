import * as React from 'react';
import { DidChangeTextDocumentParams, DidCloseTextDocumentParams, Location, TextDocumentContentChangeEvent, TextDocumentPositionParams } from 'vscode-languageserver-protocol';

import { EditorContext } from './contexts';
import { DocumentPosition, Keyed, PositionHelpers, useClientNotificationEffect, useClientNotificationState, useEvent, useEventResult } from './util';
import { Info, InfoProps } from './info';

/** Manages and displays pinned infos, as well as info for the current location. */
export function Infos() {
    const ec = React.useContext(EditorContext);

    const [pinnedPoss, setPinnedPoss] = React.useState(new Array<Keyed<DocumentPosition>>());

    useEvent(ec.events.bookmarkRemoved, id => {
        setPinnedPoss(pinnedPoss => {
            return pinnedPoss.filter(i => i.key !== id);
        });
    }, [pinnedPoss]);

    useEvent(ec.events.bookmarkChanged, ([id, pos]) => {
        setPinnedPoss(pinnedPoss => {
            return pinnedPoss.map(pin => {
                if (pin.key === id){
                    // NOTE(WN): It's important to make a clone here, otherwise this
                    // actually mutates the pin. React state updates must be pure.
                    // See https://github.com/facebook/react/issues/12856
                    const newPin: Keyed<DocumentPosition> = { ...pin };
                    newPin.line = pos.position.line;
                    newPin.character = pos.position.character;
                    return newPin;
                }
                return pin;
            });
        });
    }, [pinnedPoss]);

    const curLoc = useEventResult(ec.events.changedCursorLocation)
    const curPos: DocumentPosition | undefined = curLoc ? { uri: curLoc.uri, ...curLoc.range.start } : undefined

    // Update pins on UI actions
    const isPinned = (pinnedPoss: Keyed<DocumentPosition>[], pos: DocumentPosition) => {
        return pinnedPoss.find(p => DocumentPosition.isEqual(p, pos));
    }
    const addPin = async (pos: DocumentPosition) => {
        const id = await ec.addBookmark(pos);
        setPinnedPoss(pinnedPoss => {
            // ??? how could the pin already exist and still have a pin button to click?
            // if (isPinned(pinnedPoss, pos)) return pinnedPoss;
            return [ ...pinnedPoss, { ...pos, key: id } ];
        });
    }
    const removePin = async (pos: DocumentPosition) => {
        let pinned : Keyed<DocumentPosition> | undefined;
        setPinnedPoss(pinnedPoss => {
            pinned = isPinned(pinnedPoss, pos);
            return pinnedPoss;
        });
        if (pinned) {
            await ec.removeBookmark(pinned.key);
        }
        setPinnedPoss(pinnedPoss => {
            if (!isPinned(pinnedPoss, pos)) return pinnedPoss;
            return pinnedPoss.filter(p => !DocumentPosition.isEqual(p, pos));
        });
    }
    const pin = React.useCallback(async (pos: DocumentPosition) => {
        await addPin(pos);
    }, []);
    const unpin = React.useCallback(async (pos: DocumentPosition) => {
        await removePin(pos);
    }, []);

    // Toggle pin at current position when the editor requests it
    useEvent(ec.events.requestedAction, async act => {
        if (act.kind !== 'togglePin') return
        if (!curPos) return
        let pinned : Keyed<DocumentPosition> | undefined;
        setPinnedPoss(pinnedPoss => {
            pinned = isPinned(pinnedPoss, curPos);
            return pinnedPoss;
        });
        if (pinned) {
            await removePin(curPos);
        } else {
            await addPin(curPos);
        }
    }, [curPos?.uri, curPos?.line, curPos?.character]);

    const infoProps: Keyed<InfoProps>[] = pinnedPoss.map(pos => ({ kind: 'pin', onPin: unpin, pos, key: pos.key }));
    if (curPos) infoProps.push({ kind: 'cursor', onPin: pin, key: 'cursor' });

    return <div>
        {infoProps.map (ps => <Info {...ps} />)}
        {!curPos && <p>Click somewhere in the Lean file to enable the infoview.</p> }
    </div>;
}
