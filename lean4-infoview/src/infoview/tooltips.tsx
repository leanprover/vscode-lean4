import * as React from 'react'
import * as ReactDOM from 'react-dom'

import { arrow, autoPlacement, autoUpdate, FloatingArrow, offset, shift, size, useFloating } from '@floating-ui/react'

import { ConfigContext } from './contexts'
import { LogicalDomContext, useLogicalDomObserver, useOnClickOutside } from './util'

export type TooltipProps = React.PropsWithChildren<React.HTMLProps<HTMLDivElement>> & { reference: HTMLElement | null }

export function Tooltip(props_: TooltipProps) {
    const { reference, children, style, ...props } = props_
    const arrowRef = React.useRef(null)

    const { refs, floatingStyles, context } = useFloating({
        elements: { reference },
        placement: 'top',
        middleware: [
            offset(8),
            shift(),
            autoPlacement({
                padding: 10,
            }),
            size({
                apply({ availableHeight, elements }) {
                    elements.floating.style.maxHeight = `${Math.min(availableHeight, 300)}px`
                },
                padding: 10,
            }),
            // NOTE: `padding` should be `tooltip.borderRadius` or more so that the arrow
            // doesn't overflow the rounded corner.
            arrow({ element: arrowRef, padding: 6 }),
        ],
        whileElementsMounted: autoUpdate,
    })

    const logicalDom = React.useContext(LogicalDomContext)
    const logicalDomCleanupFn = React.useRef<() => void>(() => {})
    const floating = (
        <div
            ref={node => {
                refs.setFloating(node)
                logicalDomCleanupFn.current()
                if (node) logicalDomCleanupFn.current = logicalDom.registerDescendant(node)
                else logicalDomCleanupFn.current = () => {}
            }}
            style={{ ...style, ...floatingStyles }}
            className="tooltip"
            {...props}
        >
            <FloatingArrow
                ref={arrowRef}
                context={context}
                fill="var(--vscode-editorHoverWidget-background)"
                strokeWidth={1}
                stroke="var(--vscode-editorHoverWidget-border)"
            />
            <div className="tooltip-content">{children}</div>
        </div>
    )

    // Append the tooltip to the end of document body to avoid layout issues.
    // (https://github.com/leanprover/vscode-lean4/issues/51)
    return ReactDOM.createPortal(floating, document.body)
}

export type WithToggleableTooltipProps = React.HTMLProps<HTMLSpanElement> & {
    isTooltipShown: boolean
    hideTooltip: () => void
    tooltipChildren: React.ReactNode
}

export function WithToggleableTooltip(props_: WithToggleableTooltipProps) {
    const { isTooltipShown, hideTooltip, tooltipChildren, ...props } = props_
    const [ref, setRef] = React.useState<HTMLSpanElement | null>(null)

    // Since we do not want to hide the tooltip if the user is trying to select text in it,
    // we need both the "click outside" and "click inside" handlers here because they
    // play nicer with existing selections than a global click handler.
    // With a single global click handler, any selection anywhere in the InfoView could block
    // the tooltip from being hidden. This is especially annoying because right-clicking any
    // element also selects it.
    // With both inside and outside click handlers, the outside click handler can simply disregard
    // selections, whereas React ensures that only a selection in the tooltip itself can block
    // the inside click handler from hiding the tooltip, since the outer selection is removed
    // before the inside click handler fires.
    const [logicalSpanElt, logicalDomStorage] = useLogicalDomObserver({ current: ref })
    const onClickOutside = React.useCallback(() => {
        hideTooltip()
    }, [hideTooltip])
    useOnClickOutside(logicalSpanElt, onClickOutside)

    return (
        <LogicalDomContext.Provider value={logicalDomStorage}>
            <span
                ref={setRef}
                onClick={() => {
                    if (!window.getSelection()?.toString()) hideTooltip()
                }}
                {...props}
            >
                {isTooltipShown && <Tooltip reference={ref}>{tooltipChildren}</Tooltip>}
                {props.children}
            </span>
        </LogicalDomContext.Provider>
    )
}

/** Hover state of an element. The pointer can be
 * - elsewhere (`off`)
 * - over the element (`over`)
 * - over the element with Ctrl or Meta (⌘ on Mac) held (`ctrlOver`)
 */
export type HoverState = 'off' | 'over' | 'ctrlOver'

export type DetectHoverSpanProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
    setHoverState: React.Dispatch<React.SetStateAction<HoverState>>
}

/** An element which calls `setHoverState` when the hover state of its DOM children changes.
 *
 * It is implemented with JS rather than CSS in order to allow nesting of these elements. When nested,
 * only the smallest (deepest in the DOM tree) {@link DetectHoverSpan} has an enabled hover state. */
export function DetectHoverSpan(props_: DetectHoverSpanProps) {
    const { setHoverState, ...props } = props_
    const ref = React.useRef<HTMLSpanElement | null>(null)

    const onPointerEvent = (b: boolean, e: React.PointerEvent<HTMLSpanElement>) => {
        // It's more composable to let pointer events bubble up rather than to call `stopPropagation`,
        // but we only want to handle hovers in the innermost component. So we record that the
        // event was handled with a property.
        // The `contains` check ensures that the node hovered over is a child in the DOM
        // tree and not just a logical React child (see useLogicalDom and
        // https://reactjs.org/docs/portals.html#event-bubbling-through-portals).
        if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
            if ('_DetectHoverSpanSeen' in e) return
            ;(e as any)._DetectHoverSpanSeen = {}
            if (!b) setHoverState('off')
            else if (e.ctrlKey || e.metaKey) setHoverState('ctrlOver')
            else setHoverState('over')
        }
    }

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') setHoverState(st => (st === 'over' ? 'ctrlOver' : st))
        }

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') setHoverState(st => (st === 'ctrlOver' ? 'over' : st))
        }

        // Note: In VSCode these events do not fire when the webview is not in focus.
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('keyup', onKeyUp)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
        }
    }, [setHoverState])

    return (
        <span
            {...props}
            ref={ref}
            onPointerOver={e => {
                onPointerEvent(true, e)
                if (props.onPointerOver) props.onPointerOver(e)
            }}
            onPointerOut={e => {
                onPointerEvent(false, e)
                if (props.onPointerOut) props.onPointerOut(e)
            }}
            onPointerMove={e => {
                if (e.ctrlKey || e.metaKey) setHoverState(st => (st === 'over' ? 'ctrlOver' : st))
                else setHoverState(st => (st === 'ctrlOver' ? 'over' : st))
                if (props.onPointerMove) props.onPointerMove(e)
            }}
        >
            {props.children}
        </span>
    )
}

/** Pinning a child tooltip has to also pin all ancestors. This context supports that. */
interface TipChainContext {
    pinParent(): void
}

const TipChainContext = React.createContext<TipChainContext>({ pinParent: () => {} })

export type WithTooltipOnHoverProps = Omit<React.HTMLProps<HTMLSpanElement>, 'onClick'> & {
    tooltipChildren: React.ReactNode
    onClick?: (event: React.MouseEvent<HTMLSpanElement>, next: React.MouseEventHandler<HTMLSpanElement>) => void
}

export function WithTooltipOnHover(props_: WithTooltipOnHoverProps) {
    const { tooltipChildren, onClick: onClickProp, ...props } = props_
    const [ref, setRef] = React.useState<HTMLSpanElement | null>(null)

    const config = React.useContext(ConfigContext)

    // We are pinned when clicked, shown when hovered over, and otherwise hidden.
    type TooltipState = 'pin' | 'show' | 'hide'
    const [state, setState] = React.useState<TooltipState>('hide')
    const shouldShow = state !== 'hide'

    const tipChainCtx = React.useContext(TipChainContext)
    React.useEffect(() => {
        if (state === 'pin') tipChainCtx.pinParent()
    }, [state, tipChainCtx])
    const newTipChainCtx = React.useMemo(
        () => ({
            pinParent: () => {
                setState('pin')
                tipChainCtx.pinParent()
            },
        }),
        [tipChainCtx],
    )

    // Note: because tooltips are attached to `document.body`, they are not descendants of the
    // hoverable area in the DOM tree. Thus the `contains` check fails for elements within tooltip
    // contents and succeeds for elements within the hoverable. We can use this to distinguish them.
    const isWithinHoverable = (el: EventTarget) => ref && el instanceof Node && ref.contains(el)
    const [logicalSpanElt, logicalDomStorage] = useLogicalDomObserver({ current: ref })

    // We use timeouts for debouncing hover events.
    const timeout = React.useRef<number>()
    const clearTimeout = () => {
        if (timeout.current) {
            window.clearTimeout(timeout.current)
            timeout.current = undefined
        }
    }
    const showDelay = 500
    const hideDelay = 300

    const isModifierHeld = (e: React.MouseEvent) => e.altKey || e.ctrlKey || e.shiftKey || e.metaKey

    const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
        clearTimeout()
        setState(state => (state === 'pin' ? 'hide' : 'pin'))
        e.stopPropagation()
    }

    const onClickOutside = React.useCallback(() => {
        clearTimeout()
        setState('hide')
    }, [])
    useOnClickOutside(logicalSpanElt, onClickOutside)

    const isPointerOverTooltip = React.useRef<boolean>(false)
    const startShowTimeout = () => {
        clearTimeout()
        if (!config.showTooltipOnHover) return
        timeout.current = window.setTimeout(() => {
            setState(state => (state === 'hide' ? 'show' : state))
            timeout.current = undefined
        }, showDelay)
    }
    const startHideTimeout = () => {
        clearTimeout()
        timeout.current = window.setTimeout(() => {
            if (!isPointerOverTooltip.current) setState(state => (state === 'show' ? 'hide' : state))
            timeout.current = undefined
        }, hideDelay)
    }

    const onPointerEnter = (e: React.PointerEvent<HTMLSpanElement>) => {
        isPointerOverTooltip.current = true
        clearTimeout()
    }

    const onPointerLeave = (e: React.PointerEvent<HTMLSpanElement>) => {
        isPointerOverTooltip.current = false
        startHideTimeout()
    }

    function guardMouseEvent(
        act: (_: React.MouseEvent<HTMLSpanElement>) => void,
        e: React.MouseEvent<HTMLSpanElement>,
    ) {
        if ('_WithTooltipOnHoverSeen' in e) return
        if (!isWithinHoverable(e.target)) return
        ;(e as any)._WithTooltipOnHoverSeen = {}
        act(e)
    }

    return (
        <LogicalDomContext.Provider value={logicalDomStorage}>
            <span
                {...props}
                ref={setRef}
                onClick={e => {
                    guardMouseEvent(e => {
                        if (onClickProp !== undefined) onClickProp(e, onClick)
                        else onClick(e)
                    }, e)
                }}
                onPointerDown={e => {
                    // We have special handling for some modifier+click events, so prevent default browser
                    // events from interfering when a modifier is held.
                    if (isModifierHeld(e)) e.preventDefault()
                }}
                onPointerOver={e => {
                    if (!isModifierHeld(e)) {
                        guardMouseEvent(_ => startShowTimeout(), e)
                    }
                    if (props.onPointerOver !== undefined) props.onPointerOver(e)
                }}
                onPointerOut={e => {
                    guardMouseEvent(_ => startHideTimeout(), e)
                    if (props.onPointerOut !== undefined) props.onPointerOut(e)
                }}
            >
                {shouldShow && (
                    <TipChainContext.Provider value={newTipChainCtx}>
                        <Tooltip reference={ref} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
                            {tooltipChildren}
                        </Tooltip>
                    </TipChainContext.Provider>
                )}
                {props.children}
            </span>
        </LogicalDomContext.Provider>
    )
}
