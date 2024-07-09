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

export interface ToggleableTooltip {
    tooltip: JSX.Element
    tooltipDisplayed: boolean
    setTooltipDisplayed: (tooltipDisplayed: boolean) => void
    onClick: () => void
    onClickOutside: () => void
}

export function useToggleableTooltip(
    ref: React.RefObject<HTMLSpanElement>,
    tooltipChildren: React.ReactNode,
): ToggleableTooltip {
    const [anchor, setAnchor] = React.useState<HTMLSpanElement | null>(null)
    const [tooltipDisplayed, setTooltipDisplayed_] = React.useState<boolean>(false)
    const setTooltipDisplayed = (tooltipDisplayed: boolean) => {
        setTooltipDisplayed_(tooltipDisplayed)
        if (tooltipDisplayed) {
            setAnchor(ref.current)
        }
    }

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
    const onClickOutside = () => {
        setTooltipDisplayed(false)
    }

    const onClick = () => {
        if (!window.getSelection()?.toString()) {
            setTooltipDisplayed(false)
        }
    }

    const tooltip = <>{tooltipDisplayed && <Tooltip reference={anchor}>{tooltipChildren}</Tooltip>}</>

    return {
        tooltip,
        tooltipDisplayed,
        setTooltipDisplayed,
        onClick,
        onClickOutside,
    }
}

/** Hover state of an element. The pointer can be
 * - elsewhere (`off`)
 * - over the element (`over`)
 * - over the element with Ctrl or Meta (⌘ on Mac) held (`ctrlOver`)
 */
export type HoverState = 'off' | 'over' | 'ctrlOver'

/** Pinning a child tooltip has to also pin all ancestors. This context supports that. */
export interface TipChainContext {
    pinParent(): void
}

export const TipChainContext = React.createContext<TipChainContext>({ pinParent: () => {} })

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
