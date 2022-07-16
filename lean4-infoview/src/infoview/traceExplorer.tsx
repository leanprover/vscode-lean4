/**
 * Traces of any substantial compilation or elaboration process are usually extremely verbose,
 * which makes them slow (or even infeasible) to pretty-print and difficult to understand.
 * Instead, we provide a "TraceExplorer" UI which allows users to lazily expand trace subtrees,
 * and (TODO) execute search queries.
 *
 * @module
 */

import * as React from 'react'
import { RpcContext } from './contexts'
import { Goal } from './goals'
import { InteractiveCode, InteractiveTaggedText, InteractiveTagProps, InteractiveTextComponentProps } from './interactiveCode'
import { InteractiveDiagnostics_msgToInteractive, MessageData, MsgEmbed, TaggedText } from './rpcInterface'
import { DocumentPosition, mapRpcError } from './util'

function CollapsibleTrace({pos, col, cls, msg}: {pos: DocumentPosition, col: number, cls: string, msg: MessageData}) {
    type State =
        { state: 'collapsed' } |
        { state: 'loading' } |
        { state: 'open', tt: TaggedText<MsgEmbed> } |
        { state: 'error', err: string }

    const rs = React.useContext(RpcContext)
    const [st, setSt] = React.useState<State>({state: 'collapsed'})

    const fetchTrace = () => {
        setSt({state: 'loading'})
        void InteractiveDiagnostics_msgToInteractive(rs, pos, msg, col)
            .then(tt => {
                if (tt) setSt({state: 'open', tt})
                else setSt({state: 'error', err: 'no trace found'})
            })
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
            <InteractiveMessage pos={pos} fmt={st.tt} />
        </>
    else if (st.state === 'error')
        return <><span className="underline-hover pointer"
            onClick={ev => {
                fetchTrace()
                ev.stopPropagation()
            }}>[{cls}] Error (click to retry):</span> {st.err}</>
    else throw new Error('unreachable')
}

function InteractiveMessageTag({pos, tag: embed, fmt}: InteractiveTagProps<MsgEmbed>): JSX.Element {
    if ('expr' in embed)
        return <InteractiveCode pos={pos} fmt={embed.expr} />
    else if ('goal' in embed)
        return <Goal pos={pos} goal={embed.goal} filter={{reverse: false, isType: false, isInstance: false, isHiddenAssumption: false}} />
    else if ('lazyTrace' in embed)
        return <CollapsibleTrace pos={pos} col={embed.lazyTrace[0]} cls={embed.lazyTrace[1]} msg={embed.lazyTrace[2]} />
    else
        throw new Error(`malformed 'MsgEmbed': '${embed}'`)
}

export function InteractiveMessage({pos, fmt}: InteractiveTextComponentProps<MsgEmbed>) {
    return InteractiveTaggedText({pos, fmt, InnerTagUi: InteractiveMessageTag})
}
