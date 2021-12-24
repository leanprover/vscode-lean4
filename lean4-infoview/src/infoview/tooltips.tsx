import * as React from 'react'

import { Instance as TippyInstance, Props as RawTippyProps, Placement as TippyPlacement } from 'tippy.js'
import { default as Tippy, TippyProps } from '@tippyjs/react'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/light-border.css'

import { forwardAndUseRef, LogicalDomContext, useLogicalDomNode } from './util'

/** A `<span>` element which gets highlighted when hovered over. It is implemented with JS rather
 * than CSS in order to allow nesting of these elements. When nested, only the smallest nested
 * element is highlighted. */
export const HighlightOnHoverSpan = forwardAndUseRef<HTMLSpanElement, React.HTMLProps<HTMLSpanElement>>((props, ref) => {
  const [isPointerInside, setIsPointerInside] = React.useState<boolean>(false)
  const onPointerOver = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (ref.current && e.target == ref.current)
      setIsPointerInside(true)
  }

  const onPointerOut = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (ref.current && e.target == ref.current)
      setIsPointerInside(false)
  }

  return <span
      ref={ref}
      className={isPointerInside ? 'highlight' : ''}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      {...props}
    >
      {props.children}
    </span>
})

/** Will only render the `content` or `render` elements if the tippy is mounted to the DOM.
 * From https://gist.github.com/atomiks/520f4b0c7b537202a23a3059d4eec908 */
const LazyTippy = React.forwardRef<HTMLElement, TippyProps>((props, ref) => {
  const [mounted, setMounted] = React.useState(false)

  const lazyPlugin = {
    fn: () => ({
      onMount: () => setMounted(true),
      onHidden: () => setMounted(false),
    }),
  }

  const computedProps: React.PropsWithChildren<TippyProps> = {...props}

  computedProps.plugins = [lazyPlugin, ...(props.plugins || [])]

  if (props.render) {
    computedProps.render = (...args) => (mounted && props.render ? props.render(...args) : undefined)
  } else {
    computedProps.content = mounted ? props.content : undefined
  }

  return <Tippy {...computedProps} ref={ref} />
})

interface TipChainContext {
  placement: TippyPlacement
}

/** Invariant: a tooltip is the root iff this is `undefined`. */
const TipChainContext = React.createContext<TipChainContext | undefined>(undefined);

/** Tooltip contents should call `redrawTooltip` on every update. */
export type TooltipContent = (redrawTooltip: () => void) => React.ReactNode

/** Shows a tooltip when the children are hovered over or clicked. */
export function WithTooltipOnHover(props_: React.HTMLProps<HTMLSpanElement> & {tooltipContent: TooltipContent}): JSX.Element {
  const {tooltipContent, ...props} = props_

  // We are pinned when clicked, shown when hovered over, and otherwise hidden.
  type TooltipState = 'pin' | 'show' | 'hide'
  const [state, setState] = React.useState<TooltipState>('hide')

  const tippyInstance = React.useRef<TippyInstance>()
  React.useEffect(() => {
    if (state === 'hide') tippyInstance.current?.hide()
    else tippyInstance.current?.show()
  }, [state])

  const spanRef = React.useRef<HTMLSpanElement>(null)
  // The tooltip which gets attached to `document.body` is a logical child of this component.
  const tippyNode = useLogicalDomNode()

  // We remember the global trend in placement (as `placement`) so tooltip chains can bounce off
  // the top and continue downwards or vice versa and initialize to that, but then update the trend
  // (as `ourPlacement`).
  const tipCtx = React.useContext(TipChainContext)
  const placement = tipCtx ? tipCtx.placement : 'top'
  const [ourPlacement, setOurPlacement] = React.useState<TippyPlacement>(placement)

  const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    // Note: because tooltips are attached to `document.body`, they are not our descendants
    // in the DOM tree and the `contains` check fails for clicks within tooltip contents.
    // This is correct since we don't want these to show or hide the tooltip.
    if (spanRef && spanRef.current?.contains(e.target as Node)) {
      setState(state => state === 'pin' ? 'hide' : 'pin')
      e.stopPropagation()
    }
  }

  const onClickOutsideTip = (inst: TippyInstance<RawTippyProps>, e: Event) => {
    // Check if click is outside any of our descendants.
    if (!spanRef.current?.contains(e.target as Node) && !tippyNode.contains(e.target as Node))
      setState('hide')
  }

  return <TipChainContext.Provider value={{ placement: ourPlacement}}>
    <LogicalDomContext.Provider value={tippyNode}>
      <LazyTippy
        content={tooltipContent(() => tippyInstance.current?.popperInstance?.update())}
        placement={placement}
        // We don't use interactive hiding but still need this to make the contents clickable.
        interactive
        // Disable Tippy's own click handling.
        trigger='manual'
        hideOnClick={false}
        // To avoid weird layout issues where the browser does not like a <div> popping up
        // in the middle of a string of spans, even though the div is position:absolute, it is
        // causing newlines to appear (bug https://github.com/leanprover/vscode-lean4/issues/51).
        // Even though the default is appendTo='parent' that is not enough because
        // InteractiveCode -> InteractiveCodeTag -> InteractiveCode is recursive, we end up
        // with a string of nested spans, where the Tippy div then shows up in one of those
        // spans rather than the end of them all.  The guaranteed solution is to move the Tippy div
        // to the end of the document body where that can do no harm.
        appendTo={() => document.body}
        onCreate={inst => tippyInstance.current = inst}
        onDestroy={() => tippyInstance.current = undefined}
        onShown={inst => {
          tippyNode.ref(inst.popper)
          if (inst.popperInstance) setOurPlacement(inst.popperInstance.state.placement)
        }}
        onClickOutside={onClickOutsideTip}
      >
        <span
          {...props}
          ref={spanRef}
          onClick={onClick}
        >
          {props.children}
        </span>
      </LazyTippy>
    </LogicalDomContext.Provider>
  </TipChainContext.Provider>
}
