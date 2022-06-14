import * as React from 'react';
import type { Location } from 'vscode-languageserver-protocol';

import { EditorContext, RpcContext } from './contexts';
import { mapRpcError, } from './rpcInterface';
import { DocumentPosition, useAsync, useEventResult } from './util';
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
 * [todo] cache on widgetId, but then there needs to be some way of signalling that the widgetId's code has changed if the user edits it?
 */
export async function Widget_getStaticJS(rs: RpcSessions, pos: DocumentPosition, widgetId: string): Promise<StaticJS | undefined> {
    try {
        return await rs.call(pos, 'Lean.Widget.getStaticJS', { 'pos': DocumentPosition.toTdpp(pos), widgetId })
    } catch (e) {
        return handleWidgetRpcError(e)
    }
}


function memoize<T extends (...args: any[]) => any>(fn: T, keyFn: any = (x: any) => x): T {
    const cache = new Map()
    const r: any = (...args: any[]) => {
        const key = keyFn(...args)
        if (!cache.has(key)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const result = fn(...args)
            if (result) {
                cache.set(key, result)
            }
            return result
        }
        return cache.get(key)
    }
    return r
}

const dynamicallyLoadComponent = memoize(function (hash: number, code: string,) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
})

interface GetWidgetResult {
    component?: any
    id: string
    hash: number
    props: any
}

const getCode = memoize(
    (rc: RpcSessions, pos: DocumentPosition, widget: GetWidgetResponse) => Widget_getStaticJS(rc, pos, widget.id),
    (rc: RpcSessions, pos: DocumentPosition, widget: GetWidgetResponse) => widget.hash,
)

async function getWidget(rc: RpcSessions, pos: DocumentPosition): Promise<undefined | GetWidgetResult> {
    const widget = await Widget_getWidget(rc, pos)
    if (!widget) {
        return undefined
    }
    const code = await getCode(rc, pos, widget)
    if (!code) {
        return widget
    }
    const component = dynamicallyLoadComponent(widget.hash, code.javascript)
    return { ...widget, component }
}

export function UserWidget(props: any) {
    const ec = React.useContext(EditorContext);
    const rs = React.useContext(RpcContext);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const curLoc = useEventResult<Location | undefined>(
        ec.events.changedCursorLocation,
        // @ts-ignore
        (loc, prev) => loc ?? prev
    )
    if (!curLoc) {
        return <>Waiting for a location.</>
    }
    const curPos: DocumentPosition = { uri: curLoc.uri, ...curLoc.range.start };
    const [status, result, error] = useAsync(() => getWidget(rs, curPos), [curPos.uri, curPos.line, curPos.character])

    const widgetId = result?.id
    const ps = { pos: curPos, ...result?.props }
    const component = result?.component

    return (
        <React.Suspense fallback={`Loading widget: ${widgetId} ${status}.`}>
            <ErrorBoundary>
                {component && <div>{React.createElement(component, ps)}</div>}
                {error && <div>{mapRpcError(error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
