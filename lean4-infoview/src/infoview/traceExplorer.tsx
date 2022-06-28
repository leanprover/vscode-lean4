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
import { DocumentPosition } from './util'

function CollapsibleTrace({pos, col, cls, msg}: {pos: DocumentPosition, col: number, cls: string, msg: MessageData}) {
    const rs = React.useContext(RpcContext)
    const [tt, setTt] = React.useState<TaggedText<MsgEmbed> | undefined>(undefined)

    let inner
    if (tt) {
        inner = <>
            <span className="underline-hover pointer"
                onClick={ev => {
                    setTt(undefined)
                    ev.stopPropagation()
                }}>[{cls}] ∨</span>
            <InteractiveMessage pos={pos} fmt={tt} />
        </>
    } else {
        inner =
            <span className="underline-hover pointer"
                onClick={ev => {
                    void InteractiveDiagnostics_msgToInteractive(rs, pos, msg, col).then(t => t && setTt(t))
                    ev.stopPropagation()
                }}>[{cls}] &gt;</span>
    }
    return inner
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
