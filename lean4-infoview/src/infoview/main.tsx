import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { DocumentUri, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';

import 'tachyons/css/tachyons.css';
import 'vscode-codicons/dist/codicon.css';
import './index.css';

import { Infos } from './infos';
import { AllMessages } from './messages';
import { useEvent, useServerNotificationState } from './util';
import { LeanDiagnostic, LeanFileProgressParams, LeanFileProgressProcessingInfo } from '../lspTypes';
import { EditorContext, ConfigContext, DiagnosticsContext, ProgressContext } from './contexts';
import { WithRpcSessions } from './rpcSessions';
import { EditorConnection, EditorEvents } from './editorConnection';
import { defaultInfoviewConfig, EditorApi, InfoviewApi } from '../infoviewApi';
import { Event } from './event';

function Main(props: {}) {
    if (!props) { return null }
    const ec = React.useContext(EditorContext);

    /* Set up updates to the global infoview state on editor events. */
    const [config, setConfig] = React.useState(defaultInfoviewConfig);
    useEvent(ec.events.changedInfoviewConfig, cfg => setConfig(cfg), []);
    const [allDiags, _0] = useServerNotificationState(
        'textDocument/publishDiagnostics',
        new Map<DocumentUri, LeanDiagnostic[]>(),
        (allDiags, params: PublishDiagnosticsParams) => {
            const docDiags = params.diagnostics.map((d) => {
                return { ...d as LeanDiagnostic, uri: params.uri }
            });
            // HACK: React does a shallow comparison and doesn't figure out
            // it should update if only the map contents change.
            const newMap = new Map(allDiags);
            return newMap.set(params.uri, docDiags);
        },
        []
    );
    const [allProgress, _1] = useServerNotificationState(
        '$/lean/fileProgress',
        new Map<DocumentUri, LeanFileProgressProcessingInfo[]>(),
        (allProgress, params: LeanFileProgressParams) => {
            const newProgress = new Map(allProgress);
            return newProgress.set(params.textDocument.uri, params.processing);
        },
        []
    );
    const [curUri, setCurUri] = React.useState<DocumentUri>('');
    useEvent(ec.events.changedCursorLocation, loc => setCurUri(loc.uri), []);

    if (!curUri) return <p>Click somewhere in the Lean file to enable the infoview.</p>;

    return (
    <ConfigContext.Provider value={config}>
        <DiagnosticsContext.Provider value={allDiags}>
            <ProgressContext.Provider value={allProgress}>
                <WithRpcSessions>
                    <div className="ma1">
                        <Infos />
                        <div className="mv2">
                            <AllMessages uri={curUri} />
                        </div>
                    </div>
                </WithRpcSessions>
            </ProgressContext.Provider>
        </DiagnosticsContext.Provider>
    </ConfigContext.Provider>
    );
}

/**
 * Renders the Lean infoview into the webpage.
 * @param editorApi
 * @param uiElement the HTML element (e.g. a `<div>`) to render into
 */
export function renderInfoview(editorApi: EditorApi, uiElement: HTMLElement): InfoviewApi {
    let editorEvents: EditorEvents = {
        gotServerNotification: new Event(),
        sentClientNotification: new Event(),
        changedCursorLocation: new Event(),
        changedInfoviewConfig: new Event(),
        requestedAction: new Event(),
    };

    // Challenge: write a type-correct fn from `Eventify<T>` to `T` without using `any`
    const infoviewApi: InfoviewApi = {
        gotServerNotification: async (method, params) => {
            editorEvents.gotServerNotification.fire([method, params]);
        },
        sentClientNotification: async (method, params) => {
            editorEvents.sentClientNotification.fire([method, params]);
        },
        changedCursorLocation: async loc => editorEvents.changedCursorLocation.fire(loc),
        changedInfoviewConfig: async conf => editorEvents.changedInfoviewConfig.fire(conf),
        requestedAction: async action => editorEvents.requestedAction.fire(action),
    };

    const ec = new EditorConnection(editorApi, editorEvents);

    ReactDOM.render(
        <React.StrictMode>
            <EditorContext.Provider value={ec}>
                <Main />
            </EditorContext.Provider>
        </React.StrictMode>,
        uiElement
    );

    return infoviewApi;
}