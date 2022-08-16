import * as React from 'react';

import { Widget_getWidgetSource, UserWidget, UserWidgetInstance } from '@leanprover/infoview-api';
import { RpcContext } from './rpcSessions';
import { DocumentPosition, mapRpcError, useAsync } from './util';
import { ErrorBoundary } from './errors';

function dynamicallyLoadComponent(hash: string, code: string) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
}

const componentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>()

interface UserWidgetProps {
    pos: DocumentPosition
    widget: UserWidgetInstance
}

export function UserWidget({ pos, widget }: UserWidgetProps) {
    const rs = React.useContext(RpcContext);
    const hash = widget.javascriptHash
    const component = useAsync(
        async () => {
            if (componentCache.has(hash)) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                return componentCache.get(hash)!
            }
            const code = await Widget_getWidgetSource(rs, pos, hash)
            const component = dynamicallyLoadComponent(hash, code.sourcetext)
            componentCache.set(hash, component)
            return component
        },
        [hash])

    const componentProps = { pos, ...widget.props }

    return (
        <React.Suspense fallback={`Loading widget: ${widget.id} ${component.state}.`}>
            <ErrorBoundary>
                {component.state === 'resolved' && <div>{React.createElement(component.value, componentProps)}</div>}
                {component.state === 'rejected' && <div>{mapRpcError(component.error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
