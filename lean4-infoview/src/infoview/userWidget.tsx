import * as React from 'react';
import type { Location } from 'vscode-languageserver-protocol';

import { EditorContext, RpcContext } from './contexts';
import { Details } from './collapsing';
import { DocumentPosition, mapRpcError, useAsync, useEventResult } from './util';
import { ErrorBoundary } from './errors';
import { RpcSessions } from './rpcSessions';
import { isRpcError, RpcErrorCode } from '@lean4/infoview-api';

function handleWidgetRpcError(e: unknown): undefined {
    if (isRpcError(e)) {
        if (e.code === RpcErrorCode.MethodNotFound || e.code === RpcErrorCode.InvalidParams) {
            return undefined
        } else {
            throw Error(`RPC Error: ${RpcErrorCode[e.code]}: ${e.message}`)
        }
    } else if (e instanceof Error) {
        throw e
    } else {
        throw Error(`Unknown rpc error ${JSON.stringify(e)}`)
    }
}

export interface UserWidgetInfo {
    widgetSourceId: string
    hash : string
    props : any
    range?: Range
}

export interface GetWidgetInfosResponse {
    infos : UserWidgetInfo[]
}

export function Widget_getWidgetInfos(rs: RpcSessions, pos: DocumentPosition): Promise<GetWidgetInfosResponse | undefined> {
    return rs.call<GetWidgetInfosResponse | undefined>(pos, 'Lean.Widget.getWidgetInfos', DocumentPosition.toTdpp(pos))
        .catch<undefined>(handleWidgetRpcError);
}

export interface WidgetSource {
    widgetSourceId : string
    sourcetext : string
    hash: string
}

/** Gets the static JS code for a given widget.
 *
 * We make the assumption that either the code doesn't exist, or it exists and does not change for the lifetime of the widget.
 */
export async function Widget_getWidgetSource(rs: RpcSessions, pos: DocumentPosition, widgetSourceId: string): Promise<WidgetSource | undefined> {
    try {
        return await rs.call(pos, 'Lean.Widget.getWidgetSource', { 'pos': DocumentPosition.toTdpp(pos), widgetSourceId })
    } catch (e) {
        return handleWidgetRpcError(e)
    }
}

function dynamicallyLoadComponent(hash: string, code: string,) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
}

const componentCache = new Map()

interface UserWidgetProps {
    pos: DocumentPosition
    widget: UserWidgetInfo
}

export function UserWidget({ pos, widget }: UserWidgetProps) {
    const rs = React.useContext(RpcContext);
    if (!pos) {
        return <>Waiting for a location.</>
    }
    const [status, component, error] = useAsync(
        async () => {
            if (componentCache.has(widget.hash)) {
                return componentCache.get(widget.hash)
            }
            const code = await Widget_getWidgetSource(rs, pos, widget.widgetSourceId)
            if (!code) {
                throw Error(`No widget static javascript found for ${widget.widgetSourceId}.`)
            }
            const component = dynamicallyLoadComponent(widget.hash, code.sourcetext)
            componentCache.set(widget.hash, component)
            return component
        },
        [pos.uri, pos.line, pos.character, widget.hash])

    const componentProps = { pos, ...widget.props }

    return (
        <React.Suspense fallback={`Loading widget: ${ widget.widgetSourceId} ${status}.`}>
            <ErrorBoundary>
                {component && <div>{React.createElement(component, componentProps)}</div>}
                {error && <div>{mapRpcError(error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
