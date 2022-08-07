/**
 * Traces of any substantial compilation or elaboration process are usually extremely verbose,
 * which makes them slow (or even infeasible) to pretty-print and difficult to understand.
 * Instead, we provide a "TraceExplorer" UI which allows users to lazily expand trace subtrees,
 * and (TODO) execute search queries.
 *
 * @module
 */

import * as React from 'react'
import { Goal } from './goals'
import { InteractiveCode, InteractiveTaggedText, InteractiveTagProps, InteractiveTextComponentProps } from './interactiveCode'
import { InteractiveDiagnostics_msgToInteractive, lazyTraceChildrenToInteractive, MessageData, MsgEmbed, TaggedText, TraceEmbed } from '@leanprover/infoview-api'
import { mapRpcError } from './util'
import { RpcContext } from './rpcSessions'

function LazyTrace({col, cls, msg}: {col: number, cls: string, msg: MessageData}) {
    type State =
        { state: 'collapsed' } |
        { state: 'loading' } |
        { state: 'open', tt: TaggedText<MsgEmbed> } |
        { state: 'error', err: string }

    const rs = React.useContext(RpcContext)
    const [st, setSt] = React.useState<State>({state: 'collapsed'})

    const fetchTrace = () => {
        setSt({state: 'loading'})
        void InteractiveDiagnostics_msgToInteractive(rs, msg, col)
            .then(tt => setSt({state: 'open', tt}))
            .catch(e => setSt({state: 'error', err: mapRpcError(e).toString()}))
    }

    if (st.state === 'collapsed')
        return <span className="underline-hover pointer"
            onClick={ev => {
                fetchTrace()
                ev.stopPropagation()
            }}>[{cls}] &gt;</span>
    else if (st.state === 'loading')
        return <span>[{cls}] Loading..</span>
    else if (st.state === 'open')
        return <>
            <span className="underline-hover pointer"
                onClick={ev => {
                    setSt({state: 'collapsed'})
                    ev.stopPropagation()
                }}>[{cls}] ∨</span>
            <InteractiveMessage fmt={st.tt} />
        </>
    else if (st.state === 'error')
        return <><span className="underline-hover pointer"
            onClick={ev => {
                fetchTrace()
                ev.stopPropagation()
            }}>[{cls}] Error (click to retry):</span> {st.err}</>
    else throw new Error('unreachable')
}

const TraceClassContext = React.createContext<string>('')

function abbreviateCommonPrefix(parent: string, cls: string): string {
    const parentParts = parent.split('.');
    const clsParts = cls.split('.');
    let i = 0;
    for (; i < parentParts.length && i < clsParts.length && parentParts[i] === clsParts[i]; i++);
    return clsParts.slice(i).join('.');
}

function Trace({indent, cls, msg, collapsed: collapsed0, children}: TraceEmbed) {
    type State =
        { state: 'collapsed' } |
        { state: 'loading' } |
        { state: 'open', tt: TaggedText<MsgEmbed>[] } |
        { state: 'error', err: string }

    const rs = React.useContext(RpcContext)
    const [st, setSt] = React.useState<State>(
        (!collapsed0 && 'strict' in children) ? {state: 'open', tt: children.strict} : {state: 'collapsed'});
    // TODO: reset state when props change

    const fetchTrace = () => {
        if ('strict' in children) {
            setSt({state: 'open', tt: children.strict})
        } else {
            setSt({state: 'loading'})
            void lazyTraceChildrenToInteractive(rs, children.lazy)
                .then(tt => setSt({state: 'open', tt}))
                .catch(e => setSt({state: 'error', err: mapRpcError(e).toString()}))
        }
    }

    const spaces = ' '.repeat(indent)

    const noChildren = 'strict' in children && children.strict.length === 0;
    const icon =
        noChildren ? '' :
        st.state === 'collapsed' ? '▶' :
        st.state === 'loading' ? '᠁' :
        st.state === 'error' ? '⚠' :
        st.state === 'open' ? '▼' :
        '';

    const abbrCls = abbreviateCommonPrefix(React.useContext(TraceClassContext), cls);
    let line = <>{spaces}<span className="trace-class" title={cls}>[{abbrCls}]</span> <InteractiveMessage fmt={msg}/> {icon}</>;
    if (noChildren) {
        line = <div>{line}</div>; // same DOM structure as other cases
    } else if (st.state === 'open') {
        line = <div className="pointer" onClick={ev => {
            setSt({state: 'collapsed'})
            ev.stopPropagation();
        }}>{line}</div>;
    } else if (st.state === 'collapsed' || st.state === 'error') {
        line = <div className="pointer" onClick={ev => {
            fetchTrace();
            ev.stopPropagation();
        }}>{line}</div>;
    } else {
        line = <div>{line}</div>; // same DOM structure as other cases
    }

    return <div>
        <div className="trace-line">{line}</div>
        <TraceClassContext.Provider value={cls}>
            {st.state === 'open' && st.tt.map((tt, i) => <InteractiveMessage fmt={tt} key={i}/>)}
            {st.state === 'error' && st.err}
        </TraceClassContext.Provider>
    </div>
}

function InteractiveMessageTag({tag: embed}: InteractiveTagProps<MsgEmbed>): JSX.Element {
    if ('expr' in embed)
        return <InteractiveCode fmt={embed.expr} />
    else if ('goal' in embed)
        return <Goal goal={embed.goal} filter={{reverse: false, isType: false, isInstance: false, isHiddenAssumption: false}} />
    else if ('lazyTrace' in embed)
        return <LazyTrace col={embed.lazyTrace[0]} cls={embed.lazyTrace[1]} msg={embed.lazyTrace[2]} />
    else if ('trace' in embed)
        return <Trace {...embed.trace} />
    else
        return <div>malformed MsgEmbed: {JSON.stringify(embed)}</div>
}

export function InteractiveMessage({fmt}: InteractiveTextComponentProps<MsgEmbed>) {
    return InteractiveTaggedText({fmt, InnerTagUi: InteractiveMessageTag})
}
