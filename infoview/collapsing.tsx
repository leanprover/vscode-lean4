import * as React from 'react';

/** Returns `[node, isVisible]`. Attach `node` to the dom element you care about as `<div ref={node}>...</div>` and
 * `isVisible` will change depending on whether the node is visible in the viewport or not. */
export function useIsVisible(): [(element: HTMLElement) => void, boolean] {
    const [isVisible,setIsVisible] = React.useState<boolean>(false);
    const observer = React.useRef<IntersectionObserver>(null);
    const node = React.useCallback<(element: HTMLElement) => void>(n => {
        if (observer.current) {
            observer.current.disconnect();
        }
        if (n !== null) {
            // this is called when the given element is mounted.
            observer.current = new IntersectionObserver(([x]) => {
                setIsVisible(x.isIntersecting);
            }, { threshold: 0, root: null, rootMargin: '0px'});
            observer.current.observe(n);
        } else {
            // when unmounted
        }
    }, []);
    return [node, isVisible]
}

interface DetailsProps {
    initiallyOpen?: boolean;
    children: [JSX.Element, ...JSX.Element[]];
    setOpenRef?: React.MutableRefObject<React.Dispatch<React.SetStateAction<boolean>>>;
}
export function Details({initiallyOpen, children: [summary, ...children], setOpenRef}: DetailsProps): JSX.Element {
    const [isOpen, setOpen] = React.useState<boolean>(initiallyOpen === undefined ? false : initiallyOpen);
    const setupEventListener = React.useCallback((node?: HTMLDetailsElement) => {
        if (node !== null) {
            node.addEventListener('toggle', () => setOpen(node.open));
        }
    }, []);
    if (setOpenRef) setOpenRef.current = setOpen;
    return <details ref={setupEventListener} open={isOpen}>
        {summary}
        { isOpen && children }
    </details>;
}