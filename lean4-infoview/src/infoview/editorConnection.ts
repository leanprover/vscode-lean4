import type { Location, ShowDocumentParams } from 'vscode-languageserver-protocol';

import { EditorApi, InfoviewApi, PlainGoal, PlainTermGoal } from '@lean4/infoview-api';

import { Eventify } from './event';
import { DocumentPosition } from './util';

export type EditorEvents = Eventify<InfoviewApi>;

export class EditorConnection {
  constructor(readonly api: EditorApi, readonly events: EditorEvents) {}

  /** Highlights the given range in a document in the editor. */
  async revealLocation(loc: Location) {
    const show: ShowDocumentParams = {
      uri: loc.uri,
      selection: loc.range,
    };
    await this.api.showDocument(show);
  }

  async revealPosition(pos: DocumentPosition) {
    const loc: Location = {
      uri: pos.uri,
      range: {
        start: pos,
        end: pos,
      },
    };
    await this.revealLocation(loc);
  }

  /** Copies the text to a comment at the cursor position. */
  async copyToComment(text: string) {
    await this.api.insertText(`/-\n${text}\n-/`, 'above');
  }

  requestPlainGoal(pos: DocumentPosition): Promise<PlainGoal | undefined> {
    const params = DocumentPosition.toTdpp(pos);
    return this.api.sendClientRequest(pos.uri, '$/lean/plainGoal', params);
  }

  requestPlainTermGoal(pos: DocumentPosition): Promise<PlainTermGoal | undefined> {
    const params = DocumentPosition.toTdpp(pos);
    return this.api.sendClientRequest(pos.uri, '$/lean/plainTermGoal', params);
  }
}

export class ErrorInfo
{
    setErrorState: React.Dispatch<React.SetStateAction<string>> | undefined;
    error: string = '';

    initialize(getErrorState: string, setErrorState : React.Dispatch<React.SetStateAction<string>> ) {
        this.error = getErrorState;
        this.setErrorState = setErrorState;
    }

    setError(msg:string) {
        if (this.setErrorState){
            this.setErrorState(_ => { return msg; });
        }
    }
}
