import * as esmlexer from 'es-module-lexer'
import * as React from 'react'

import {
    InteractiveGoal,
    InteractiveTermGoal,
    RpcSessionAtPos,
    UserWidgetInstance,
    Widget_getWidgetSource,
} from '@leanprover/infoview-api'
import { EnvPosContext } from './contexts'
import { ErrorBoundary } from './errors'
import { GoalsLocation } from './goalLocation'
import { useRpcSession } from './rpcSessions'
import { DocumentPosition, mapRpcError, useAsyncPersistent } from './util'
import { rewriteModule } from './rewriteModule'

<<<<<<< HEAD
async function dynamicallyLoadModule(hash: string, code: string): Promise<[any, string]> {
    const file = new File([code], `widget_${hash}.js`, { type: 'text/javascript' })
    const url = URL.createObjectURL(file)
    return [await import(url), url]
=======
async function dynamicallyLoadModule(hash: string, code: string): Promise<any> {
    const newCode = await rewriteModule(code)
    const file = new File([newCode], `widget_${hash}.js`, { type: 'text/javascript' })
    const url = URL.createObjectURL(file)
    return await import(/* webpackIgnore: true */ url)
>>>>>>> 153f5673 (fix: rewrite dynamic imports)
}

/** Maps module hash to (loaded module, its URI). */
const moduleCache = new Map<string, [any, string]>()

/**
 * Fetch source code from Lean and dynamically import it as a JS module.
 *
 * The source must hash to `hash` (in Lean)
 * and must have been annotated with `@[widget]` or `@[widget_module]`
 * at some point before `pos`.
 *
 * If `hash` does not correspond to a registered module,
 * the promise is rejected with an error.
 *
 * #### Experimental `import` support for widget modules
 *
 * The module may import other `@[widget_module]`s by hash
 * using the URI scheme `'widget_module:hash,<hash>'`
 * where `<hash>` is a decimal representation
 * of the hash stored in `Lean.Widget.Module.javascriptHash`.
 *
 * In the future,
 * we may support importing widget modules by their fully qualified Lean name
 * (e.g. `'widget_module:name,Lean.Meta.Tactic.TryThis.tryThisWidget'`),
 * or some way to assign widget modules a more NPM-friendly name
 * so that the usual URIs (e.g. `'@leanprover-community/pro-widgets'`) work.
 */
export async function importWidgetModule(rs: RpcSessionAtPos, pos: DocumentPosition, hash: string): Promise<any> {
    if (moduleCache.has(hash)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [mod, _] = moduleCache.get(hash)!
        return mod
    }
    const resp = await Widget_getWidgetSource(rs, pos, hash)
    let src = resp.sourcetext

    /*
     * Now we want to handle imports of other `@[widget_module]`s in `src`.
     * At least two ways of doing this are possible:
     * 1. Set a module resolution hook in `es-module-shims` to look through a global list of resolvers,
     *    and register such a resolver here before loading a new module.
     *    The resolver would add appropriate entries into the import map
     *    before `src` is loaded and makes use of those entries.
     *    However, resolution hooking and dynamic import maps are not standard features
     *    so necessarily require `es-module-shims`;
     *    they would not work with any current browser's ES module implementation.
     *    Furthermore, this variant involves complex global state.
     * 2. Before loading the module, parse its imports,
     *    recursively import any widget modules,
     *    and replace widget module imports with `blob:` URIs.
     *    We do this as it is independent of `es-module-shims`.
     *    A disadvantage is that this variant does not modify the global import map,
     *    so any module that is not imported as a widget module (e.g. is imported from NPM)
     *    cannot import widget modules.
     */

    await esmlexer.init
    const [imports] = esmlexer.parse(src)
    // How far indices into `src` after the last-processed `import`
    // are offset from indices into `resp.sourcetext`
    let off = 0
    for (const i of imports) {
        const HASH_URI_SCHEME = 'widget_module:hash,'
        if (i.n?.startsWith(HASH_URI_SCHEME)) {
            const h = i.n.substring(HASH_URI_SCHEME.length)
            await importWidgetModule(rs, pos, h)
            // `moduleCache.has(h)` is a postcondition of `importWidgetModule`
            const [_, uri] = moduleCache.get(h)!
            // Replace imported module name with the new URI
            src = src.substring(0, i.s + off) + uri + src.substring(i.e + off)
            off += uri.length - i.n.length
        }
    }
    const [mod, uri] = await dynamicallyLoadModule(hash, src)
    moduleCache.set(hash, [mod, uri])
    return mod
}

export interface DynamicComponentProps {
    hash: string
    props: any
    /** @deprecated set {@link EnvPosContext} instead */
    pos?: DocumentPosition
}

/**
 * Use {@link importWidgetModule} to import a module
 * which must `export default` a React component,
 * and render that with `props`.
 * Errors in the component are caught in an error boundary.
 *
 * The {@link EnvPosContext} must be set.
 * It is used to retrieve the `Lean.Environment`
 * from which the widget module identified by `hash`
 * is obtained.
 */
export function DynamicComponent(props_: React.PropsWithChildren<DynamicComponentProps>) {
    const { hash, props, children } = props_
    const rs = useRpcSession()
    const pos = React.useContext(EnvPosContext)
    const state = useAsyncPersistent(() => {
        if (!pos) throw new Error('position context is not set')
        return importWidgetModule(rs, pos, hash)
    }, [rs, pos, hash])
    return (
        <React.Suspense fallback={`Loading component '${hash}'..`}>
            <ErrorBoundary>
                {state.state === 'resolved' && React.createElement(state.value.default, props, children)}
                {state.state === 'rejected' && <span className="red">Error: {mapRpcError(state.error).message}</span>}
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
    return <DynamicComponent hash={widget.javascriptHash} props={componentProps} />
}
