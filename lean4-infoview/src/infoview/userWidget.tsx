import * as React from 'react';

import { Widget_getWidgetSource, UserWidgetInstance, InteractiveGoal, InteractiveTermGoal, RpcSessionAtPos } from '@leanprover/infoview-api';
import { RpcContext } from './rpcSessions';
import { DocumentPosition, mapRpcError, useAsync } from './util';
import { ErrorBoundary } from './errors';
import { GoalsLocation } from './goalLocation';

async function dynamicallyLoadModule(hash: string, code: string): Promise<any> {
    const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
    const url = URL.createObjectURL(file)
    return await import(url)
}

const moduleCache = new Map<string, any>()

/**
 * Fetch source code from Lean and dynamically import it as a JS module.
 *
 * The source must hash to `hash` (in Lean) and must have been annotated with `@[widget]`
 * or `@[widget_module]` at some point before `pos`. */
export async function importWidgetModule(rs: RpcSessionAtPos, pos: DocumentPosition, hash: string): Promise<any> {
    const resp = await Widget_getWidgetSource(rs, pos, hash)
    if (moduleCache.has(hash)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return moduleCache.get(hash)!
    }
    const mod = await dynamicallyLoadModule(hash, resp.sourcetext)
    moduleCache.set(hash, mod)
    return mod
}

export interface DynamicComponentProps {
    pos: DocumentPosition
    hash: string
    props: any
}

/**
 * Use {@link importWidgetModule} to import a module which must `export default` a React component,
 * and render that with `props`. Errors in the component are caught in an error boundary. */
export function DynamicComponent(props_: React.PropsWithChildren<DynamicComponentProps>) {
    const { pos, hash, props, children } = props_
    const rs = React.useContext(RpcContext)
    const component = useAsync(async () => {
        const mod = await importWidgetModule(rs, pos, hash)
        return React.lazy(async () => mod)
    }, [hash])

    return (
        <React.Suspense fallback={`Loading component ${hash}: ${component.state}.`}>
            <ErrorBoundary>
                {component.state === 'resolved' && React.createElement(component.value, props, children)}
                {component.state === 'rejected' && <>Error: {mapRpcError(component.error).message}</>}
            </ErrorBoundary>
        </React.Suspense>
    )
}

interface PanelWidgetDisplayProps {
    pos: DocumentPosition
    goals: InteractiveGoal[]
    termGoal?: InteractiveTermGoal
    selectedLocations: GoalsLocation[]
    widget: UserWidgetInstance
}

/** Props that every infoview panel widget receives as input to its `default` export. */
export interface PanelWidgetProps {
    /** Cursor position in the file at which the widget is being displayed. */
    pos: DocumentPosition
    /** The current tactic-mode goals. */
    goals: InteractiveGoal[]
    /** The current term-mode goal, if any. */
    termGoal?: InteractiveTermGoal
    /** Locations currently selected in the goal state. */
    selectedLocations: GoalsLocation[]
}

export function PanelWidgetDisplay({ pos, goals, termGoal, selectedLocations, widget }: PanelWidgetDisplayProps) {
    const componentProps: PanelWidgetProps = { pos, goals, termGoal, selectedLocations, ...widget.props }
    return <DynamicComponent pos={pos} hash={widget.javascriptHash} props={componentProps} />
}
