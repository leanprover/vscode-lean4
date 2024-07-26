import * as React from 'react'

/** Returns `[node, isVisible]`. Attach `node` to the dom element you care about as `<div ref={node}>...</div>` and
 * `isVisible` will change depending on whether the node is visible in the viewport or not. */
// NOTE: Unused.
export function useIsVisible(): [(element: HTMLElement) => void, boolean] {
    const [isVisible, setIsVisible] = React.useState<boolean>(false)
    const observer = React.useRef<IntersectionObserver | null>(null)
    const node = React.useCallback<(element: HTMLElement) => void>(n => {
        if (observer.current) {
            observer.current.disconnect()
        }
        if (n !== null) {
            // this is called when the given element is mounted.
            observer.current = new IntersectionObserver(
                ([x]) => {
                    setIsVisible(x.isIntersecting)
                },
                { threshold: 0, root: null, rootMargin: '0px' },
            )
            observer.current.observe(n)
        } else {
            // when unmounted
        }
    }, [])
    return [node, isVisible]
}

interface DetailsProps {
    initiallyOpen?: boolean
    children: [React.ReactNode, ...React.ReactNode[]]
    setOpenRef?: (_: React.Dispatch<React.SetStateAction<boolean>>) => void
}

/** Like `<details>` but can be programatically revealed using `setOpenRef`. */
export function Details({ initiallyOpen, children: [summary, ...children], setOpenRef }: DetailsProps): JSX.Element {
    const [isOpen, setOpen] = React.useState<boolean>(initiallyOpen === undefined ? false : initiallyOpen)
    const setupEventListener = React.useCallback((node: HTMLDetailsElement | null) => {
        if (node !== undefined && node !== null) {
            // Prevents the native click event from firing and opening/closing the tag.
            // This is necessary because we do not want the `details` tag to react to
            // clicks when we call `e.stopPropagation()` in a synthetic React click event further down in the DOM,
            // since synthetic React events are only executed after the corresponding native event
            // has already fully bubbled up the DOM, and so a synthetic React event cannot stop the propagation
            // of the corresponding native event.
            node.addEventListener('click', e => {
                e.preventDefault()
            })
        }
    }, [])
    if (setOpenRef) setOpenRef(setOpen)
    return (
        <details ref={setupEventListener} open={isOpen} onClick={_ => setOpen(!isOpen)}>
            {summary}
            {isOpen && children}
        </details>
    )
}
