import * as React from 'react';

import { Widget_getWidgetSource, UserWidgetInstance, InteractiveGoal, InteractiveTermGoal } from '@leanprover/infoview-api';
import { RpcContext } from './rpcSessions';
import { DocumentPosition, mapRpcError, useAsync } from './util';
import { ErrorBoundary } from './errors';
import { GoalsLocation } from './goalLocation';

function dynamicallyLoadComponent(hash: string, code: string) {
    return React.lazy(async () => {
        const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
        const url = URL.createObjectURL(file)
        return await import(url)
    })
}

const componentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>()

interface UserWidgetDisplayProps {
    pos: DocumentPosition
    goals: InteractiveGoal[]
    termGoal?: InteractiveTermGoal
    selectedLocations: GoalsLocation[]
    widget: UserWidgetInstance
}

/** Props that every user widget receives as input to its `default` export. */
export interface UserWidgetProps {
    /** Cursor position in the file at which the widget is being displayed. */
    pos: DocumentPosition
    /** The current tactic-mode goals. */
    goals: InteractiveGoal[]
    /** The current term-mode goal, if any. */
    termGoal?: InteractiveTermGoal
    /** Locations currently selected in the goal state. */
    selectedLocations: GoalsLocation[]
}

export function UserWidgetDisplay({ pos, goals, termGoal, selectedLocations, widget }: UserWidgetDisplayProps) {
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

    const componentProps: UserWidgetProps = { pos, goals, termGoal, selectedLocations, ...widget.props }

    return (
        <React.Suspense fallback={`Loading widget: ${widget.id} ${component.state}.`}>
            <ErrorBoundary>
                {component.state === 'resolved' && <div>{React.createElement(component.value, componentProps)}</div>}
                {component.state === 'rejected' && <div>{mapRpcError(component.error).message}</div>}
            </ErrorBoundary>
        </React.Suspense>
    )
}
