import * as React from 'react';
import type { Location } from 'vscode-languageserver-protocol';

import { EditorContext, RpcContext } from './contexts';
import { Details } from './collapsing';
import { DocumentPosition, mapRpcError, useAsync, useEventResult } from './util';
import { ErrorBoundary } from './errors';
import { RpcSessions } from './rpcSessions';
import { isRpcError, RpcErrorCode } from '@lean4/infoview-api';

export interface GetWidgetResponse {
    id: string
    hash: number
    props: any
}

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

export function Widget_getWidget(rs: RpcSessions, pos: DocumentPosition): Promise<GetWidgetResponse | undefined> {
    return rs.call<GetWidgetResponse | undefined>(pos, 'Lean.Widget.getWidget', DocumentPosition.toTdpp(pos))
        .catch<undefined>(handleWidgetRpcError);
}

export interface StaticJS {
    javascript: string
    hash: number
}

/** Gets the static JS code for a given widget.
 *
 * We make the assumption that either the code doesn't exist, or it exists and does not change for the lifetime of the widget.
 */
export async function Widget_getStaticJS(rs: RpcSessions, pos: DocumentPosition, widgetId: string): Promise<StaticJS | undefined> {
    try {
        return await rs.call(pos, 'Lean.Widget.getStaticJS', { 'pos': DocumentPosition.toTdpp(pos), widgetId })
    } catch (e) {
        return handleWidgetRpcError(e)
    }
}

function dynamicallyLoadComponent(hash: number, code: string,) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
}

const componentCache = new Map()

interface UserWidgetProps {
    pos: DocumentPosition
    widget: GetWidgetResponse
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
            const code = await Widget_getStaticJS(rs, pos, widget.id)
            if (!code) {
                throw Error(`No widget static javascript found for ${widget.id}.`)
            }
            const component = dynamicallyLoadComponent(widget.hash, code.javascript)
            componentCache.set(widget.hash, component)
            return component
        },
        [pos.uri, pos.line, pos.character, widget.hash])

    const widgetId = widget.id
    const componentProps = { pos, ...widget.props }

    return (
        <React.Suspense fallback={`Loading widget: ${widgetId} ${status}.`}>
            <ErrorBoundary>
                {component && <div>{React.createElement(component, componentProps)}</div>}
                {error && <div>{mapRpcError(error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
