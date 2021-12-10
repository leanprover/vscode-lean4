import * as React from 'react'
import { Instance as TippyInstance, Props as TippyRawProps } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/light-border.css'
import { default as Tippy, TippyProps } from '@tippyjs/react'

import { RpcContext } from './contexts'
import { DocumentPosition } from './util'
import { CodeToken, CodeWithInfos, InfoPopup, InfoWithCtx, InteractiveDiagnostics_infoToInteractive, TaggedText } from './rpcInterface'

export interface InteractiveTextComponentProps<T> {
  pos: DocumentPosition
  fmt: TaggedText<T>
}

export interface InteractiveTagProps<T> extends InteractiveTextComponentProps<T> {
  tag: T
}

export interface InteractiveTaggedTextProps<T> extends InteractiveTextComponentProps<T> {
  InnerTagUi: (_: InteractiveTagProps<T>) => JSX.Element
}

/**
 * Core loop to display `TaggedText` objects. Invokes `InnerTagUi` on `tag` nodes in order to support
 * various embedded information such as `InfoTree`s and `Expr`s.
 * */
export function InteractiveTaggedText<T>({pos, fmt, InnerTagUi}: InteractiveTaggedTextProps<T>) {
  if ('text' in fmt) return <>{fmt.text}</>
  else if ('append' in fmt) return <>
    {fmt.append.map((a, i) => <InteractiveTaggedText key={i} pos={pos} fmt={a} InnerTagUi={InnerTagUi} />)}
  </>
  else if ('tag' in fmt) return <InnerTagUi pos={pos} fmt={fmt.tag[1]} tag={fmt.tag[0]} />
  else throw new Error(`malformed 'TaggedText': '${fmt}'`)
}

/**
 * Will only render the `content` or `render` elements if the tippy is mounted to the DOM.
 * From https://gist.github.com/atomiks/520f4b0c7b537202a23a3059d4eec908
 */
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

/** Shows `explicitValue : itsType` and a docstring if there is one. */
function TypePopupContents({pos, info, redrawTooltip}: {pos: DocumentPosition, info: InfoWithCtx, redrawTooltip: () => void}) {
  const rs = React.useContext(RpcContext)
  // When `err` is defined we show the error,
  // otherwise if `ip` is defined we show its contents,
  // otherwise a 'loading' message.
  const [ip, setIp] = React.useState<InfoPopup>()
  const [err, setErr] = React.useState<string>()

  React.useEffect(() => {
    InteractiveDiagnostics_infoToInteractive(rs, pos, info).then(val => {
      if (val) {
        setErr(undefined)
        setIp(val)
        // We let Tippy.js know that the tooltip should be re-rendered,
        // since it has new contents.
        redrawTooltip()
      }
    }).catch(ex => {
      if ('message' in ex) setErr('' + ex.message)
      else if ('code' in ex) setErr(`RPC error (${ex.code})`)
      else setErr(JSON.stringify(ex))
      redrawTooltip()
    })
  }, [])

  if (err)
    return <>Error: {err}</>

  if (ip) {
    return <>
      {ip.exprExplicit && <InteractiveCode pos={pos} fmt={ip.exprExplicit} />} : {ip.type && <InteractiveCode pos={pos} fmt={ip.type} />}
      {ip.doc && <hr />}
      {ip.doc && ip.doc} {/* TODO markdown */}
    </>
  } else return <>Loading..</>
}

/**
 * Wraps children with an associated {@link InfoWithCtx} in a `span` which displays the type
 * information on hover.
 *
 * Some of Tippy.js' behaviour is not configurable enough, so we re-implement our own variant here.
 * Notably, we only want to show the popup for the innermost hovered-span in the DOM tree and not
 * others, as well as to persist the popup and (TODO) all parent popups when the span is clicked.
 */
const HoverableTypePopupSpan =
  React.forwardRef<HTMLSpanElement, React.HTMLProps<HTMLSpanElement>
                                    & {pos: DocumentPosition, info: InfoWithCtx}>((props, ref) => {
  // HACK: We store the raw Tippy.js instance in order to be able to call `hideWithInteractivity`
  const tippyInstance = React.useRef<TippyInstance<TippyRawProps>>()
  const timeout = React.useRef<number>()
  const [stick, setStick] = React.useState<boolean>(false)
  const [isInside, setIsInside] = React.useState<boolean>(false)
  const delay = 500
  void tippyInstance.current?.popperInstance?.update()

  const onPointerOver = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    setIsInside(true)
    if (timeout.current) window.clearTimeout(timeout.current)
    timeout.current = window.setTimeout(() => {
      if (tippyInstance.current)
        tippyInstance.current.show()
    }, delay)
  }
  const onPointerOut = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    setIsInside(false)
    if (stick) return
    if (timeout.current) window.clearTimeout(timeout.current)
    timeout.current = window.setTimeout(() => {
      if (tippyInstance.current)
        tippyInstance.current.hideWithInteractivity(e.nativeEvent)
    }, delay)
  }

  const onClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    setStick(true)
    if (tippyInstance.current)
      tippyInstance.current.show()
  }

  return (
    <LazyTippy
      ref={ref}
      // To avoid weird layout bugs where Chrome does not like a <div> popping up
      // in the middle of a string of spans, even though the div is position:absolute, it is
      // causing newlines to appear (bug https://github.com/leanprover/vscode-lean4/issues/51).
      // Even though the default is appendTo='parent' that is not enough because
      // InteractiveCode -> InteractiveCodeTag -> InteractiveCode is recursive, we end up
      // with a string of nested spans, where the the Tippy div then shows up in one of those
      // spans rather than the end of them all.  The guaranteed solution is to move those divs
      // to the end of the document body where that can do no harm.
      appendTo= {() => document.body}
      onCreate={inst => tippyInstance.current = inst}
      content={
        <TypePopupContents
          redrawTooltip={() => void tippyInstance.current?.popperInstance?.update()}
          {...props}
        />}

      onClickOutside={() => {
        if (tippyInstance.current && !isInside) {
          tippyInstance.current.hide()
          setStick(false)
        }
      }}
      hideOnClick={false}
      interactive={true}
      trigger='manual'
    >
      <span
        onPointerOver={onPointerOver}
        className={isInside ? 'highlight' : ''}
        onPointerOut={onPointerOut}
        onClick={onClick}
        {...props}
      >
        {props.children}
      </span>
    </LazyTippy>
  )
})

/** Tags in code represent values which can be hovered over to display extra info. */
function InteractiveCodeTag({pos, tag: ct, fmt}: InteractiveTagProps<CodeToken>) {
  return (
    <HoverableTypePopupSpan pos={pos} info={ct.info}>
      <InteractiveCode pos={pos} fmt={fmt} />
    </HoverableTypePopupSpan>)
}

export function InteractiveCode({pos, fmt}: {pos: DocumentPosition, fmt: CodeWithInfos}) {
  return InteractiveTaggedText({pos, fmt, InnerTagUi: InteractiveCodeTag})
}
