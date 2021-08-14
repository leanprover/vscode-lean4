import * as React from 'react'
import fastIsEqual from 'react-fast-compare'
import { Location, DocumentUri, DiagnosticSeverity, PublishDiagnosticsParams } from 'vscode-languageserver-protocol'

import { basename, escapeHtml, RangeHelpers, usePausableState, useEvent, addUniqueKeys, DocumentPosition, useServerNotificationState } from './util'
import { ConfigContext, EditorContext, DiagnosticsContext, RpcContext } from './contexts'
import { Details } from './collapsing'
import { InteractiveMessage } from './traceExplorer'
import { getInteractiveDiagnostics, InteractiveDiagnostic, TaggedText_stripTags } from './rpcInterface'

interface MessageViewProps {
    uri: DocumentUri
    diag: InteractiveDiagnostic
}

const MessageView = React.memo(({uri, diag}: MessageViewProps) => {
    const ec = React.useContext(EditorContext)
    const fname = escapeHtml(basename(uri))
    const {line, character} = diag.range.start
    const loc: Location = { uri, range: diag.range }
    const text = TaggedText_stripTags(diag.message)
    const severityClass = diag.severity ? {
        [DiagnosticSeverity.Error]: 'error',
        [DiagnosticSeverity.Warning]: 'warning',
        [DiagnosticSeverity.Information]: 'information',
        [DiagnosticSeverity.Hint]: 'hint',
    }[diag.severity] : ''
    const title = `${fname}:${line+1}:${character}`
    return (
    <details open>
        <summary className={severityClass + ' mv2 pointer'}>{title}
            <span className="fr">
                <a className="link pointer mh2 dim codicon codicon-go-to-file"
                   onClick={e => { e.preventDefault(); ec.revealLocation(loc) }}
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
        .sort(({fullRange: {end: a}}, {fullRange: {end: b}}) =>
            a.line === b.line ? a.character - b.character : a.line - b.line
        ).map(m => {
            return { uri, diag: m }
        })

    return addUniqueKeys(views, v => DocumentPosition.toString({uri: v.uri, ...v.diag.range.start}))
}

export interface MessagesAtFileProps {
    uri: DocumentUri
    messages: InteractiveDiagnostic[]
}

/** Shows the given messages for the given file. */
export function MessagesAtFile({uri, messages}: MessagesAtFileProps) {
    const should_hide = messages.length === 0
    if (should_hide) { return <>No messages.</> }

    return (
    <div className="ml1">
        {mkMessageViewProps(uri, messages).map(m => <MessageView {...m} />)}
    </div>
    )
}

/** Displays all messages for the specified file. Can be paused. */
export function AllMessages({uri: uri0}: { uri: DocumentUri }) {
    const ec = React.useContext(EditorContext)
    const dc = React.useContext(DiagnosticsContext)
    const config = React.useContext(ConfigContext)
    let diags0 = dc.get(uri0)
    if (!diags0) diags0 = []

    const [isPaused, setPaused, [uri, diags], _] = usePausableState(false, [uri0, diags0])

    const setOpenRef = React.useRef<React.Dispatch<React.SetStateAction<boolean>>>()
    useEvent(ec.events.requestedAction, act => {
        if (act.kind === 'toggleAllMessages' && setOpenRef.current !== undefined) {
            setOpenRef.current(t => !t)
        }
    })

    return (
    <Details setOpenRef={setOpenRef as any} initiallyOpen={!config.infoViewAutoOpenShowGoal}>
        <summary className="mv2 pointer">
            All Messages ({diags.length})
            <span className="fr">
                <a className={"link pointer mh2 dim codicon " + (isPaused ? "codicon-debug-continue" : "codicon-debug-pause")}
                   onClick={e => { e.preventDefault(); setPaused(isPaused => !isPaused) }}
                   title={isPaused ? 'continue updating' : 'pause updating'}>
                </a>
            </span>
        </summary>
        <MessagesAtFile uri={uri} messages={diags} />
    </Details>
    )
}

/**
 * Provides a `DiagnosticsContext` by subscribing to server diagnostic notifications
 * and querying for interactive diagnostics whenever (LSP standard) diagnostics arrive.
 */
export function WithDiagnosticsContext(props: React.PropsWithChildren<any>) {
    const rs = React.useContext(RpcContext)
    const [allDiags, _0] = useServerNotificationState(
        'textDocument/publishDiagnostics',
        new Map<DocumentUri, InteractiveDiagnostic[]>(),
        async (params: PublishDiagnosticsParams) => {
            const diags = await getInteractiveDiagnostics(rs, { uri: params.uri, line: 0, character: 0 })
            if (!diags) return allDiags => allDiags
            return allDiags => {
                const newMap = new Map(allDiags)
                return newMap.set(params.uri, diags)
            }
        },
        []
    )

    return (
        <DiagnosticsContext.Provider value={allDiags}>
            {props.children}
        </DiagnosticsContext.Provider>
    )
}

export function useMessagesFor(pos: DocumentPosition): InteractiveDiagnostic[] {
    const config = React.useContext(ConfigContext)
    const allDiags = React.useContext(DiagnosticsContext)
    const diags = allDiags.get(pos.uri)
    if (!diags) return []
    return diags.filter(d => RangeHelpers.contains(d.range, pos, config.infoViewAllErrorsOnLine))
}
