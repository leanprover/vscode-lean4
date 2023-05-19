import * as React from 'react'
import * as ReactDOM from 'react-dom'

import {
  detectOverflow, useFloating, MiddlewareState, Side, Coords, SideObject,
  flip, shift, offset, arrow, FloatingArrow
} from '@floating-ui/react';

import { forwardAndUseRef, LogicalDomContext, useLogicalDom, useOnClickOutside } from './util'

/** Tooltip contents should call `redrawTooltip` whenever their layout changes. */
export type MkTooltipContentFn = (redrawTooltip: () => void) => React.ReactNode

// Pointer coordinates used for tooltip placement.
type PointerCoords = {pageX: number, pageY: number, clientX: number, clientY: number}

/**
* Custom floating-ui middleware to place tooltip near pointer. Pointer coordinates
* are based on the `pageX` and `pageY` propertes of the MouseEvent interface.
* Pointer coordinates are recorded - as a `pointerPos` state - everytime a
* `onPointerOver` event is triggered when hovering over a selectable element.
* Default tooltip position is above and to the right of the pointer. If the tooltip
* is outside of the viewport i.e. overflowing, we flip the tooltip to keep it inside the
* viewport. Flip logic is based on the quadrant - within the viewport - in which the
* the pointer was located when the hover event was triggered.
*/
const pointer = (pointerPos: PointerCoords) => ({
  name: 'pointer',
  async fn(state: MiddlewareState) {
    const { rects, elements } = state;

    const floatingEl = elements.floating
    const floatingRect = rects.floating

    const findPositives = (obj: SideObject) : number[] => {
      return Object.values(obj).filter((d) => d > 0)
    }

    const containsPositive = (obj : SideObject) : boolean => {
      return findPositives(obj).length > 0
    }

    const roundByDPR = (value: number) => {
      const dpr = window.devicePixelRatio || 1;
      return Math.round(value * dpr) / dpr;
    }

    const flip = (coords: Coords, side: Side): Coords => {
      switch(side) {
        case 'top': coords.y = coords.y + floatingRect.height + 20; break;
        case 'right': coords.x = coords.x - floatingRect.width; break
      }
      return coords
    }

    const partial = (fn: (coords: Coords, side: Side) => Coords, side: Side) => {
      return (coords: Coords) => { return fn(coords, side) }
    }

    type QuadTransforms = {
      [k in string]: { [k: string]: (coords: Coords) => Coords }
    }
    const quadTransforms: QuadTransforms = {
      'top-left': {'top': partial(flip, 'top'),},
      'top-right': {'top': partial(flip, 'top'), 'right': partial(flip, 'right')},
      'bottom-right': {'right': partial(flip, 'right')},
      'bottom-left' : {},
    }

    // Split viewport into four quadrants.
    type Quadrants = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
    const getQuadrant = (x: number, y: number) : Quadrants => {
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const hvw = vw / 2
      const hvh = vh / 2

      if (x <= hvw && y <= hvh) { return 'top-left' }
      else if (x <= hvw && y > hvh) { return 'bottom-left' }
      else if (x > hvw && y > hvh) { return 'bottom-right' }
      else { return 'top-right' }
    }

    // Preferred position of tooltip is top-right relative to pointer.
    let coords: Coords = {
      x: pointerPos.pageX,
      y: pointerPos.pageY - floatingRect.height - 10
    }
    state.x = coords.x
    state.y = coords.y
    let overflow : SideObject = await detectOverflow(state);
    const quadrant = getQuadrant(pointerPos.clientX, pointerPos.clientY)

    // Apply transformations if tooltip is overflowing. Transformations to
    // be applied depend on where the pointer is located in the viewport.
    if (containsPositive(overflow)) {
      const transforms = quadTransforms[quadrant]
      Object.entries(transforms).forEach(([side, transform]) => {
        if (overflow[side as Side] > 1) { coords = transform(coords) }
      })
      state.x = coords.x
      state.y = coords.y
      overflow = await detectOverflow(state)

      // If tooltip is still overflowing, make small adjustments.
      if (containsPositive(overflow)) {
        Object.entries(overflow)
          .filter(([_, overflowAmount]) => overflowAmount > 1)
          .forEach(([side, overflowAmount]) => {
            switch(side as Side) {
              case 'top': coords.y = document.documentElement.scrollTop + 1; break;
              // case 'bottom': coords.y = coords.y + overflowAmount + 1; break;
              case 'left': coords.x = coords.x + overflowAmount + 1; break;
              case 'right': coords.x = coords.x - overflowAmount - 1; break;
            }
          })
      }
    }

    // [subpixel accelerated positioning]
    // (https://floating-ui.com/docs/misc#subpixel-and-accelerated-positioning).
    Object.assign(floatingEl.style, {
      top: '0',
      left: '0',
      transform: `translate(${roundByDPR(coords.x)}px,${roundByDPR(coords.y)}px)`,
    });

    return {}
  }
});

export const Tooltip = forwardAndUseRef<HTMLDivElement,
      React.HTMLProps<HTMLDivElement> &
    { reference: HTMLElement | null,
      pointerPos: PointerCoords,
      mkTooltipContent: MkTooltipContentFn,
    }>((props_, _, setDivRef) => {
  const {reference, pointerPos, mkTooltipContent, ...props} = props_
  const arrowRef = React.useRef(null);

  const { refs, update, floatingStyles, context } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip(), shift(), arrow({ element: arrowRef, })]
  })
  const update_ = React.useCallback(() => update?.(), [update])

  const logicalDom = React.useContext(LogicalDomContext)
  const floating = (
    <div
      ref={node => {
        refs.setReference(reference)
        refs.setFloating(node)
        setDivRef(node)
        logicalDom.registerDescendant(node)
      }}
      style={floatingStyles}
      className='tooltip'
      {...props}
    >
      <FloatingArrow
        ref={arrowRef}
        context={context}
        fill="var(--vscode-editorHoverWidget-background)"
        strokeWidth={1}
        stroke="var(--vscode-editorHoverWidget-border)"
      />
      {mkTooltipContent(update_)}
    </div>
  )

  // Append the tooltip to the end of document body to avoid layout issues.
  // (https://github.com/leanprover/vscode-lean4/issues/51)
  return ReactDOM.createPortal(floating, document.body)
})

/** Hover state of an element. The pointer can be
 * - elsewhere (`off`)
 * - over the element (`over`)
 * - over the element with Ctrl or Meta (⌘ on Mac) held (`ctrlOver`)
 */
export type HoverState = 'off' | 'over' | 'ctrlOver'

/** An element which calls `setHoverState` when the hover state of its DOM children changes.
 *
 * It is implemented with JS rather than CSS in order to allow nesting of these elements. When nested,
 * only the smallest (deepest in the DOM tree) {@link DetectHoverSpan} has an enabled hover state. */
export const DetectHoverSpan =
  forwardAndUseRef<HTMLSpanElement,
    React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> &
    {setHoverState: React.Dispatch<React.SetStateAction<HoverState>>}>((props_, ref, setRef) => {
  const {setHoverState, ...props} = props_;

  const onPointerEvent = (b: boolean, e: React.PointerEvent<HTMLSpanElement>) => {
    // It's more composable to let pointer events bubble up rather than to call `stopPropagation`,
    // but we only want to handle hovers in the innermost component. So we record that the
    // event was handled with a property.
    // The `contains` check ensures that the node hovered over is a child in the DOM
    // tree and not just a logical React child (see useLogicalDom and
    // https://reactjs.org/docs/portals.html#event-bubbling-through-portals).
    if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
      if ('_DetectHoverSpanSeen' in e) return
      (e as any)._DetectHoverSpanSeen = {}
      if (!b) setHoverState('off')
      else if (e.ctrlKey || e.metaKey) setHoverState('ctrlOver')
      else setHoverState('over')
    }
  }

  React.useEffect(() => {
    const onKeyDown = (e : KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta')
        setHoverState(st => st === 'over' ? 'ctrlOver' : st)
    }

    const onKeyUp = (e : KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta')
        setHoverState(st => st === 'ctrlOver' ? 'over' : st)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return <span
      {...props}
      ref={setRef}
      onPointerOver={e => {
        onPointerEvent(true, e)
        if (props.onPointerOver) props.onPointerOver(e)
      }}
      onPointerOut={e => {
        onPointerEvent(false, e)
        if (props.onPointerOut) props.onPointerOut(e)
      }}
      onPointerMove={e => {
        if (e.ctrlKey || e.metaKey)
          setHoverState(st => st === 'over' ? 'ctrlOver' : st)
        else
          setHoverState(st => st === 'ctrlOver' ? 'over' : st)
        if (props.onPointerMove) props.onPointerMove(e)
      }}
    >
      {props.children}
    </span>
})

interface TipChainContext {
  pinParent(): void
}

const TipChainContext = React.createContext<TipChainContext>({pinParent: () => {}})

/** Shows a tooltip when the children are hovered over or clicked.
 *
 * An `onClick` middleware can optionally be given in order to control what happens when the
 * hoverable area is clicked. The middleware can invoke `next` to execute the default action
 * which is to pin the tooltip open. */
export const WithTooltipOnHover =
  forwardAndUseRef<HTMLSpanElement,
    Omit<React.HTMLProps<HTMLSpanElement>, 'onClick'> & {
      mkTooltipContent: MkTooltipContentFn,
      onClick?: (event: React.MouseEvent<HTMLSpanElement>, next: React.MouseEventHandler<HTMLSpanElement>) => void
    }>((props_, ref, setRef) => {
  const {mkTooltipContent, ...props} = props_

  // Pointer state used to position tooltip.
  const [pointerPos, setPointerPos] = React.useState<PointerCoords>(
    {pageX: 0, pageY: 0, clientX: 0, clientY: 0}
  )

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
  const [logicalElt, logicalDomStorage] = useLogicalDom(ref)

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

  const isModifierHeld = (e: React.MouseEvent) => (e.altKey || e.ctrlKey || e.shiftKey || e.metaKey)

  const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    clearTimeout()
    setState(state => state === 'pin' ? 'hide' : 'pin')
  }

  const onClickOutside = React.useCallback(() => {
    clearTimeout()
    setState('hide')
  }, [])
  useOnClickOutside(logicalElt, onClickOutside)

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

  const onPointerEvent = (act: () => void, e: React.PointerEvent<HTMLSpanElement>) => {
    if ('_WithTooltipOnHoverSeen' in e) return
    if (!isWithinHoverable(e.target)) return
    (e as any)._WithTooltipOnHoverSeen = {}
    act()
  }

  return <LogicalDomContext.Provider value={logicalDomStorage}>
    <span
      {...props}
      ref={setRef}
      onClick={e => {
        if (!isWithinHoverable(e.target)) return
        e.stopPropagation()
        if (props.onClick !== undefined) props.onClick(e, onClick)
        else onClick(e)
      }}
      onPointerDown={e => {
        // We have special handling for some modifier+click events, so prevent default browser
        // events from interfering when a modifier is held.
        if (isModifierHeld(e)) e.preventDefault()
      }}
      onPointerOver={e => {
        if (!isModifierHeld(e)) {
          setPointerPos({pageX: e.pageX, pageY: e.pageY, clientX: e.clientX, clientY: e.clientY})
          onPointerEvent(startShowTimeout, e)
        }
        if (props.onPointerOver !== undefined) props.onPointerOver(e)
      }}
      onPointerOut={e => {
        onPointerEvent(startHideTimeout, e)
        if (props.onPointerOut !== undefined) props.onPointerOut(e)
      }}
    >
      {shouldShow &&
        <TipChainContext.Provider value={newTipChainCtx}>
          <Tooltip
            reference={ref.current}
            pointerPos={pointerPos}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            mkTooltipContent={mkTooltipContent}
          />
        </TipChainContext.Provider>}
      {props.children}
    </span>
  </LogicalDomContext.Provider>
})
