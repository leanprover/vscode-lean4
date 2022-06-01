import * as React from 'react';
import * as ReactDOM from 'react-dom';
import type { DidCloseTextDocumentParams, Location, DocumentUri } from 'vscode-languageserver-protocol';

import 'tachyons/css/tachyons.css';
import '@vscode/codicons/dist/codicon.ttf';
import '@vscode/codicons/dist/codicon.css';
import './index.css';

import { LeanFileProgressParams, LeanFileProgressProcessingInfo, defaultInfoviewConfig, EditorApi, InfoviewApi } from '@lean4/infoview-api';

import { Infos } from './infos';
import { AllMessages, WithLspDiagnosticsContext } from './messages';
import { useClientNotificationEffect, useEventResult, useServerNotificationState } from './util';
import { EditorContext, ConfigContext, ProgressContext, VersionContext } from './contexts';
import { WithRpcSessions } from './rpcSessions';
import { EditorConnection, EditorEvents } from './editorConnection';
import { Event } from './event';
import { ServerVersion } from './serverVersion';


function Main(props: {}) {
    const ec = React.useContext(EditorContext);

    /* Set up updates to the global infoview state on editor events. */
    const config = useEventResult(ec.events.changedInfoviewConfig) || defaultInfoviewConfig;

    const [allProgress, _1] = useServerNotificationState(
        '$/lean/fileProgress',
        new Map<DocumentUri, LeanFileProgressProcessingInfo[]>(),
        async (params: LeanFileProgressParams) => (allProgress) => {
            const newProgress = new Map(allProgress);
            return newProgress.set(params.textDocument.uri, params.processing);
        },
        []
    );

    const curUri = useEventResult(ec.events.changedCursorLocation, loc => loc?.uri);

    useClientNotificationEffect(
        'textDocument/didClose',
        (params: DidCloseTextDocumentParams) => {
            if (ec.events.changedCursorLocation.current &&
                ec.events.changedCursorLocation.current.uri === params.textDocument.uri) {
                ec.events.changedCursorLocation.fire(undefined)
            }
        },
        []
    );

    const serverInitializeResult = useEventResult(ec.events.serverRestarted);
    const sv = serverInitializeResult ? new ServerVersion(serverInitializeResult.serverInfo?.version ?? '') : undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const serverStoppedResult = useEventResult(ec.events.serverStopped);
    //
    // NB: the cursor may temporarily become `undefined` when a file is closed. In this case
    // it's important not to reconstruct the `WithBlah` wrappers below since they contain state
    // that we want to persist.
    let ret
    if (!serverInitializeResult) {
        ret = <p>Waiting for Lean server to start...</p>
    } else if (serverStoppedResult){
        ret = <p>{serverStoppedResult}
        </p>
    } else if (!curUri) {
        ret = <p>Click somewhere in the Lean file to enable the infoview.</p>
    } else {
        ret =
            (<div className="ma1">
                <Infos />
                <div className="mv2">
                    <AllMessages uri={curUri} />
                </div>
            </div>)
    }

    return (
    <ConfigContext.Provider value={config}>
        <VersionContext.Provider value={sv}>
            <WithRpcSessions>
                <WithLspDiagnosticsContext>
                    <ProgressContext.Provider value={allProgress}>
                        {ret}
                    </ProgressContext.Provider>
                </WithLspDiagnosticsContext>
            </WithRpcSessions>
        </VersionContext.Provider>
    </ConfigContext.Provider>
    );
}

/**
 * Renders the Lean infoview into the webpage.
 * @param editorApi
 * @param uiElement the HTML element (e.g. a `<div>`) to render into
 */
export function renderInfoview(editorApi: EditorApi, uiElement: HTMLElement): InfoviewApi {
    const editorEvents: EditorEvents = {
        initialize: new Event(),
        gotServerNotification: new Event(),
        sentClientNotification: new Event(),
        serverRestarted: new Event(),
        serverStopped: new Event(),
        changedCursorLocation: new Event(),
        changedInfoviewConfig: new Event(),
        runTestScript: new Event(),
        requestedAction: new Event(),
    };

    // Challenge: write a type-correct fn from `Eventify<T>` to `T` without using `any`
    const infoviewApi: InfoviewApi = {
        initialize: async l => editorEvents.initialize.fire(l),
        gotServerNotification: async (method, params) => {
            editorEvents.gotServerNotification.fire([method, params]);
        },
        sentClientNotification: async (method, params) => {
            editorEvents.sentClientNotification.fire([method, params]);
        },
        serverRestarted: async r => editorEvents.serverRestarted.fire(r),
        serverStopped: async s => editorEvents.serverStopped.fire(s),
        changedCursorLocation: async loc => editorEvents.changedCursorLocation.fire(loc),
        changedInfoviewConfig: async conf => editorEvents.changedInfoviewConfig.fire(conf),
        requestedAction: async action => editorEvents.requestedAction.fire(action),
        // See https://rollupjs.org/guide/en/#avoiding-eval
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        runTestScript: async script => new Function(script)(),
        getInfoviewHtml: async () => document.body.innerHTML,
    };

    const ec = new EditorConnection(editorApi, editorEvents);

    editorEvents.initialize.on((loc: Location) => ec.events.changedCursorLocation.fire(loc))

    ReactDOM.render(<React.StrictMode>
        <EditorContext.Provider value={ec}>
            <Main/>
        </EditorContext.Provider>
    </React.StrictMode>, uiElement)

    return infoviewApi;
}
