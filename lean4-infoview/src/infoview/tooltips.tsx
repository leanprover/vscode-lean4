import * as React from 'react'

import { forwardAndUseRef } from './util'

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
