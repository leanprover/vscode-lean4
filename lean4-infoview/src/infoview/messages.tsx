import * as React from 'react';
import fastIsEqual from 'react-fast-compare';
import { Location, DocumentUri, Diagnostic, DiagnosticSeverity, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';

import { basename, escapeHtml, RangeHelpers, usePausableState, useEvent, addUniqueKeys, DocumentPosition, useServerNotificationState } from './util';
import { ConfigContext, EditorContext, LspDiagnosticsContext, RpcContext, VersionContext } from './contexts';
import { Details } from './collapsing';
import { InteractiveMessage } from './traceExplorer';
import { getInteractiveDiagnostics, InteractiveDiagnostic, TaggedText_stripTags } from './rpcInterface';
import { LeanDiagnostic } from '../lspTypes';

interface MessageViewProps {
    uri: DocumentUri;
    diag: InteractiveDiagnostic;
}

const MessageView = React.memo(({uri, diag}: MessageViewProps) => {
    const ec = React.useContext(EditorContext);
    const fname = escapeHtml(basename(uri));
    const {line, character} = diag.range.start;
    const loc: Location = { uri, range: diag.range };
    const text = TaggedText_stripTags(diag.message);
    const severityClass = diag.severity ? {
        [DiagnosticSeverity.Error]: 'error',
        [DiagnosticSeverity.Warning]: 'warning',
        [DiagnosticSeverity.Information]: 'information',
        [DiagnosticSeverity.Hint]: 'hint',
    }[diag.severity] : '';
    const title = `${fname}:${line+1}:${character}`;
    return (
    <details open>
        <summary className={severityClass + ' mv2 pointer'}>{title}
            <span className="fr">
                <a className="link pointer mh2 dim codicon codicon-go-to-file"
                   onClick={e => { e.preventDefault(); ec.revealLocation(loc); }}
                   title="reveal file location"></a>
                <a className="link pointer mh2 dim codicon codicon-quote"
                   onClick={e => {e.preventDefault(); ec.copyToComment(text)}}
                   title="copy message to comment"></a>
                <a className="link pointer mh2 dim codicon codicon-clippy"
                   onClick={e => {e.preventDefault(); void ec.api.copyToClipboard(text)}}
                   title="copy message to clipboard"></a>
            </span>
        </summary>
        <div className="ml1">
            <pre className="font-code" style={{whiteSpace: 'pre-wrap'}}>
                <InteractiveMessage pos={{uri: loc.uri, line: loc.range.start.line, character: loc.range.start.character}} fmt={diag.message} />
            </pre>
        </div>
    </details>
    )
}, fastIsEqual)

function mkMessageViewProps(uri: DocumentUri, messages: InteractiveDiagnostic[]): MessageViewProps[] {
    const views: MessageViewProps[] = messages
        .sort((msga, msgb) => {
            const a = msga.fullRange?.end || msga.range.end;
            const b = msgb.fullRange?.end || msgb.range.end;
            return a.line === b.line ? a.character - b.character : a.line - b.line
        }).map(m => {
            return { uri, diag: m };
        });

    return addUniqueKeys(views, v => DocumentPosition.toString({uri: v.uri, ...v.diag.range.start}));
}

/** Shows the given messages for the given file. */
export function MessagesList({uri, messages}: {uri: DocumentUri, messages: InteractiveDiagnostic[]}) {
    const should_hide = messages.length === 0;
    if (should_hide) { return <>No messages.</> }

    return (
    <div className="ml1">
        {mkMessageViewProps(uri, messages).map(m => <MessageView {...m} />)}
    </div>
    );
}

export interface MessagesAtFileProps {
    uri: DocumentUri;
}

/** Shows the given messages for the given file. */
export function MessagesAtFile({uri}: MessagesAtFileProps) {
    return <MessagesList uri={uri} messages={useMessagesForFile(uri)}/>
}

/** Displays all messages for the specified file. Can be paused. */
export function AllMessages({uri: uri0}: { uri: DocumentUri }) {
    const ec = React.useContext(EditorContext);
    const dc = React.useContext(LspDiagnosticsContext);
    const config = React.useContext(ConfigContext);
    let diags0 = dc.get(uri0);
    if (!diags0) diags0 = [];

    const [isPaused, setPaused, [uri, diags], _] = usePausableState(false, [uri0, diags0]);

    const setOpenRef = React.useRef<React.Dispatch<React.SetStateAction<boolean>>>();
    useEvent(ec.events.requestedAction, act => {
        if (act.kind === 'toggleAllMessages' && setOpenRef.current !== undefined) {
            setOpenRef.current(t => !t);
        }
    });

    return (
    <Details setOpenRef={setOpenRef as any} initiallyOpen={!config.infoViewAutoOpenShowGoal}>
        <summary className="mv2 pointer">
            All Messages ({diags.length})
            <span className="fr">
                <a className={"link pointer mh2 dim codicon " + (isPaused ? "codicon-debug-continue" : "codicon-debug-pause")}
                   onClick={e => { e.preventDefault(); setPaused(isPaused => !isPaused); }}
                   title={isPaused ? 'continue updating' : 'pause updating'}>
                </a>
            </span>
        </summary>
        <MessagesAtFile uri={uri} />
    </Details>
    )
}

/**
 * Provides a `DiagnosticsContext` by subscribing to server diagnostic notifications
 * and querying for interactive diagnostics whenever (LSP standard) diagnostics arrive.
 */
export function WithLspDiagnosticsContext({children}: React.PropsWithChildren<{}>) {
    const [allDiags, _0] = useServerNotificationState(
        'textDocument/publishDiagnostics',
        new Map<DocumentUri, Diagnostic[]>(),
        async (params: PublishDiagnosticsParams) => allDiags =>
            new Map(allDiags).set(params.uri, params.diagnostics),
        []
    )

    return <LspDiagnosticsContext.Provider value={allDiags}>{children}</LspDiagnosticsContext.Provider>
}

export function useMessagesForFile(uri: DocumentUri, line?: number): InteractiveDiagnostic[] {
    const rs = React.useContext(RpcContext)
    const sv = React.useContext(VersionContext)
    const lspDiags = React.useContext(LspDiagnosticsContext)
    const [diags, setDiags] = React.useState<InteractiveDiagnostic[]>([])
    async function updateDiags() {
        setDiags((lspDiags.get(uri) || []).map(d => ({ ...(d as LeanDiagnostic), message: { text: d.message } })));
        if (sv?.hasWidgetsV1()) {
            try {
                const diags = await getInteractiveDiagnostics(rs, { uri, line: 0, character: 0 },
                    line ? { start: line, end: line + 1 } : undefined)
                if (diags) {
                    setDiags(diags)
                }
            } catch (err: any) {
                console.log('getInteractiveDiagnostics error ', err)
            }
        }
    }
    React.useEffect(() => void updateDiags(), [uri, line, lspDiags.get(uri)])
    return diags;
}

export function useMessagesFor(pos: DocumentPosition): InteractiveDiagnostic[] {
    const config = React.useContext(ConfigContext);
    return useMessagesForFile(pos.uri, pos.line).filter(d => RangeHelpers.contains(d.range, pos, config.infoViewAllErrorsOnLine));
}
