import type { Location, ShowDocumentParams } from 'vscode-languageserver-protocol'

import {
    ContextMenuAction,
    EditorApi,
    InfoviewAction,
    InfoviewActionKind,
    InfoviewApi,
    PlainGoal,
    PlainTermGoal,
} from '@leanprover/infoview-api'

import { EventEmitter, Eventify } from './event'
import { DocumentPosition } from './util'

export type EditorEvents = Omit<Eventify<InfoviewApi>, 'requestedAction' | 'clickedContextMenu'> & {
    requestedAction: EventEmitter<InfoviewAction, InfoviewActionKind>
    /**
     * Must fire whenever the user clicks an infoview-specific context menu entry.
     *
     * Keys for this event are of the form `` `${action.entry}:${action.id}` ``.
     */
    clickedContextMenu: EventEmitter<ContextMenuAction, string>
    goToDefinition?: EventEmitter<number, number>
}

/** Provides higher-level wrappers around functionality provided by the editor,
 * e.g. to insert a comment. See also {@link EditorApi}. */
export class EditorConnection {
    constructor(
        readonly api: EditorApi,
        readonly events: EditorEvents,
    ) {}

    /** Highlights the given range in a document in the editor. */
    async revealLocation(loc: Location) {
        const show: ShowDocumentParams = {
            uri: loc.uri,
            selection: loc.range,
        }
        await this.api.showDocument(show)
    }

    async revealPosition(pos: DocumentPosition) {
        const loc: Location = {
            uri: pos.uri,
            range: {
                start: pos,
                end: pos,
            },
        }
        await this.revealLocation(loc)
    }

    /** Copies the text to a comment at the cursor position. */
    async copyToComment(text: string) {
        await this.api.insertText(`/-\n${text}\n-/`, 'above')
    }

    requestPlainGoal(pos: DocumentPosition): Promise<PlainGoal | undefined> {
        const params = DocumentPosition.toTdpp(pos)
        return this.api.sendClientRequest(pos.uri, '$/lean/plainGoal', params)
    }

    requestPlainTermGoal(pos: DocumentPosition): Promise<PlainTermGoal | undefined> {
        const params = DocumentPosition.toTdpp(pos)
        return this.api.sendClientRequest(pos.uri, '$/lean/plainTermGoal', params)
    }
}
