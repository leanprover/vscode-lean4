import * as React from 'react';

import { RpcContext } from './contexts';
import { DocumentPosition, mapRpcError, useAsync } from './util';
import { ErrorBoundary } from './errors';
import { Widget_getWidgetSource, UserWidget, UserWidgetInstance } from './rpcInterface';

function dynamicallyLoadComponent(hash: string, code: string) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
}

const componentCache = new Map<string,  React.LazyExoticComponent<React.ComponentType<any>>>()

interface UserWidgetProps {
    pos: DocumentPosition
    widget: UserWidgetInstance
}

export function UserWidget({ pos, widget }: UserWidgetProps) {
    const rs = React.useContext(RpcContext);
    const hash = widget.javascriptHash
    const [status, component, error] = useAsync(
        async () => {
            if (componentCache.has(hash)) {
                return componentCache.get(hash)
            }
            const code = await Widget_getWidgetSource(rs, pos, hash)
            if (!code) {
                // This case happens when the relevant RPC session is not connected, a react rerender will be triggered.
                throw new Error('Expected RPC session to be connected.')
            }
            const component = dynamicallyLoadComponent(hash, code.sourcetext)
            componentCache.set(hash, component)
            return component
        },
        [hash])

    const componentProps = { pos, ...widget.props }

    return (
        <React.Suspense fallback={`Loading widget: ${widget.id} ${status}.`}>
            <ErrorBoundary>
                {component && <div>{React.createElement(component, componentProps)}</div>}
                {error && <div>{mapRpcError(error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
