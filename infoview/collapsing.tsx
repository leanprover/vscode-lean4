import * as React from 'react';

/** Returns `[node, isVisible]`. Attach `node` to the dom element you care about as `<div ref={node}>...</div>` and
 * `isVisible` will change depending on whether the node is visible in the viewport or not. */
export function useIsVisible(): [any, boolean] {
    const [isVisible,setIsVisible] = React.useState<boolean>(false);
    const observer = React.useRef<IntersectionObserver>(null);
    const node = React.useCallback<any>(n => {
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

export function Details({open: initiallyOpen, children: [summary, ...children]}: {open?: boolean; children: [JSX.Element, ...JSX.Element[]]}): JSX.Element {
    const [isOpen, setOpen] = React.useState<boolean>(initiallyOpen === undefined ? false : true);
    const setupEventListener = React.useCallback((node?: HTMLDetailsElement) => {
        if (node !== null) {
            node.addEventListener('toggle', () => setOpen(node.open));
        }
    }, []);
    return <details ref={setupEventListener} open={initiallyOpen}>
        {summary}
        { isOpen && children }
    </details>;
}