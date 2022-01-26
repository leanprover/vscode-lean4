import * as React from 'react'
import * as ReactDOM from 'react-dom'

import * as Popper from '@popperjs/core'
import { usePopper } from 'react-popper'

import { forwardAndUseRef, LogicalDomContext, useLogicalDom } from './util'

/** Tooltip contents should call `redrawTooltip` whenever their layout changes. */
export type TooltipContent = (redrawTooltip: () => void) => React.ReactNode

const TooltipPlacementContext = React.createContext<Popper.Placement>('top')

export const Tooltip = forwardAndUseRef<HTMLDivElement,
  React.HTMLProps<HTMLDivElement> &
    { reference: HTMLElement | null,
      tooltipContent: TooltipContent,
      placement?: Popper.Placement,
      onFirstUpdate?: (_: Partial<Popper.State>) => void
    }>((props_, divRef, setDivRef) => {
  const {reference, tooltipContent, placement: preferPlacement, onFirstUpdate, ...props} = props_

  // We remember the global trend in placement (as `globalPlacement`) so tooltip chains can bounce
  // off the top and continue downwards or vice versa and initialize to that, but then update
  // the trend (as `ourPlacement`).
  const globalPlacement = React.useContext(TooltipPlacementContext)
  const placement = preferPlacement ? preferPlacement : globalPlacement
  const [ourPlacement, setOurPlacement] = React.useState<Popper.Placement>(placement)

  // https://popper.js.org/react-popper/v2/faq/#why-i-get-render-loop-whenever-i-put-a-function-inside-the-popper-configuration
  const onFirstUpdate_ = React.useCallback((state: Partial<Popper.State>) => {
    if (state.placement) setOurPlacement(state.placement)
    if (onFirstUpdate) onFirstUpdate(state)
  }, [onFirstUpdate])

  const [arrowElement, setArrowElement] = React.useState<HTMLDivElement | null>(null)
  const { styles, attributes, update } = usePopper(reference, divRef.current, {
    modifiers: [
      { name: 'arrow', options: { element: arrowElement } },
      { name: 'offset', options: { offset: [0, 8] } },
    ],
    placement,
    onFirstUpdate: onFirstUpdate_
  })
  const update_ = React.useCallback(() => update?.(), [update])

  const logicalDom = React.useContext(LogicalDomContext)

  const popper = <div
      ref={node => {
        setDivRef(node)
        logicalDom.registerDescendant(node)
      }}
      style={styles.popper}
      className='tooltip'
      {...props}
      {...attributes.popper}
    >
      <TooltipPlacementContext.Provider value={ourPlacement}>
        {tooltipContent(update_)}
      </TooltipPlacementContext.Provider>
      <div ref={setArrowElement}
        style={styles.arrow}
        className='tooltip-arrow'
      />
    </div>

  // Append the tooltip to the end of document body to avoid layout issues.
  // (https://github.com/leanprover/vscode-lean4/issues/51)
  return ReactDOM.createPortal(popper, document.body)
})

/** An element which gets highlighted when its DOM children are hovered over. It is implemented
 * with JS rather than CSS in order to allow nesting of these elements. When nested, only the
 * smallest (deepest in the DOM tree) {@link HighlightOnHoverSpan} is highlighted. */
export const HighlightOnHoverSpan = forwardAndUseRef<HTMLSpanElement, React.HTMLProps<HTMLSpanElement>>((props, ref, setRef) => {
  const [isPointerOver, setIsPointerOver] = React.useState<boolean>(false)
  const onPointerEvent = (b: boolean) => (e: React.PointerEvent<HTMLSpanElement>) => {
    // It's more composable to let pointer events bubble up rather than to `stopPropagating`,
    // but we only want to handle hovers in the innermost component. So we record that the
    // event was handled with a property.
    // The `contains` check ensures that the node hovered over is a child in the DOM
    // tree and not just a logical React child (see useLogicalDom and
    // https://reactjs.org/docs/portals.html#event-bubbling-through-portals).
    if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
      if ('_HighlightOnHoverSpanSeen' in e) return
      (e as any)._HighlightOnHoverSpanSeen = {}
      setIsPointerOver(b)
    }
  }

  return <span
      ref={setRef}
      className={'highlightable ' + (isPointerOver ? 'highlight' : '')}
      onPointerOver={onPointerEvent(true)}
      onPointerOut={onPointerEvent(false)}
      {...props}
    >
      {props.children}
    </span>
})

interface TipChainContext {
  pinParent(): void
}

const TipChainContext = React.createContext<TipChainContext>({pinParent: () => {}})

/** Shows a tooltip when the children are hovered over or clicked. */
export const WithTooltipOnHover =
  forwardAndUseRef<HTMLSpanElement,
    React.HTMLProps<HTMLSpanElement> & {tooltipContent: TooltipContent}>((props_, ref, setRef) => {
  const {tooltipContent, ...props} = props_

  // We are pinned when clicked, shown when hovered over, and otherwise hidden.
  type TooltipState = 'pin' | 'show' | 'hide'
  const [state, setState] = React.useState<TooltipState>('hide')
  const shouldShow = state !== 'hide'

  const tipChainCtx = React.useContext(TipChainContext)
  React.useEffect(() => {
    if (state === 'pin') tipChainCtx.pinParent()
  }, [state, tipChainCtx])
  const newTipChainCtx = React.useMemo(() => ({
    pinParent: () => {
      setState('pin');
      tipChainCtx.pinParent()
    }
  }), [tipChainCtx])

  // Note: because tooltips are attached to `document.body`, they are not descendants of the
  // hoverable area in the DOM tree, and the `contains` check fails for elements within tooltip
  // contents. We can use this to distinguish these elements.
  const isWithinHoverable = (el: EventTarget) => ref.current && el instanceof Node && ref.current.contains(el)
  const [logicalDom, logicalDomStorage] = useLogicalDom(ref)

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

  const onClick = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!isWithinHoverable(e.target)) return
    e.stopPropagation()
    clearTimeout()
    setState(state => state === 'pin' ? 'hide' : 'pin')
  }

  React.useEffect(() => {
    const onClickAnywhere = (e: Event) => {
      if (e.target instanceof Node && !logicalDom.contains(e.target)) {
        clearTimeout()
        setState('hide')
      }
    }

    document.addEventListener('pointerdown', onClickAnywhere)
    return () => document.removeEventListener('pointerdown', onClickAnywhere)
  }, [ref, logicalDom])

  const isPointerOverTooltip = React.useRef<boolean>(false)
  const startShowTimeout = () => {
    clearTimeout()
    timeout.current = window.setTimeout(() => {
      setState(state => state === 'hide' ? 'show' : state)
      timeout.current = undefined
    }, showDelay)
  }
  const startHideTimeout = () => {
    clearTimeout()
    timeout.current = window.setTimeout(() => {
      if (!isPointerOverTooltip.current)
        setState(state => state === 'show' ? 'hide' : state)
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

  const onPointerEvent = (act: () => void) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if ('_WithTooltipOnHoverSeen' in e) return
    if (!isWithinHoverable(e.target)) return
    (e as any)._WithTooltipOnHoverSeen = {}
    act()
  }

  return <LogicalDomContext.Provider value={logicalDomStorage}>
    <span
      ref={setRef}
      onClick={onClick}
      onPointerOver={onPointerEvent(startShowTimeout)}
      onPointerOut={onPointerEvent(startHideTimeout)}
      {...props}
    >
      {shouldShow &&
        <TipChainContext.Provider value={newTipChainCtx}>
          <Tooltip
            reference={ref.current}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            tooltipContent={tooltipContent}
          />
        </TipChainContext.Provider>}
      {props.children}
    </span>
  </LogicalDomContext.Provider>
})
