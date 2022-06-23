import * as React from 'react';

import { RpcContext } from './contexts';
import { DocumentPosition, mapRpcError, useAsync } from './util';
import { ErrorBoundary } from './errors';
import { Widget_getWidgetSource, UserWidget } from './rpcInterface';

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
    widget: UserWidget
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
            const code = await Widget_getWidgetSource(rs, pos, widget.hash)
            if (!code) {
                // This case happens when the relevant RPC session is not connected, a react rerender will be triggered.
                throw new Error('Expected RPC session to be connected.')
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
