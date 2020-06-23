import * as React from 'react';
import * as ReactPopper from 'react-popper';
import './popper.css';
import { WidgetComponent, WidgetHtml, WidgetElement, WidgetEventRequest, WidgetIdentifier } from 'lean-client-js-node';
import { global_server } from './server';
import { Location } from '../src/shared';

const Popper = (props) => {
    const { children, popperContent, refEltTag, refEltAttrs } = props;
    const [referenceElement, setReferenceElement] = React.useState(null);
    const [popperElement, setPopperElement] = React.useState(null);
    const [arrowElement, setArrowElement] = React.useState(null);
    const { styles, attributes } = ReactPopper.usePopper(referenceElement, popperElement, {
        modifiers: [
            { name: 'arrow', options: { element: arrowElement } },
            { name: 'offset', options: { offset: [0, 8] } }
        ],
    });
    const refElt = React.createElement(refEltTag, { ref: setReferenceElement, ...refEltAttrs }, children);
    return (
        <>
            {refElt}
            <div ref={setPopperElement} style={styles.popper} {...attributes.popper} className="tooltip">
                {popperContent}
                <div ref={setArrowElement} style={styles.arrow} className="arrow" />
            </div>
        </>
    );
}

export interface WidgetProps {
    widget?: WidgetIdentifier;
    onEdit?: (l: Location, text: string) => void;
    fileName: string;
}

class WidgetErrorBoundary extends React.Component<{children},{error}> {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, errorInfo) {
        console.log(error, errorInfo);
    }
    componentWillReceiveProps(new_props) {
        this.setState({error: null});
    }
    render() {
      if (this.state.error) {
        const message = this.state.error.message
        return <div className="ba b--red pa3">
            <h1>Widget rendering threw an error:</h1>
            {message}
        </div>;
      }
      return this.props.children;
    }
}

/** Returns `[node, isVisible]`. Attach `node` to the dom element you care about as `<div ref={node}>...</div>` and
 * `isVisible` will change depending on whether the node is visible in the viewport or not. */
function useIsVisible() {
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

export function Widget({ widget, fileName, onEdit }: WidgetProps): JSX.Element {
    const [html, setHtml] = React.useState<WidgetComponent>();
    const widgetContainerRef = React.useRef(null);
    const [node, isVisible] = useIsVisible();
    React.useEffect(() => {
        if (!isVisible) {return; }
        async function loadHtml() {
            setHtml((await global_server.send({
                command: 'get_widget',
                line: widget.line,
                column: widget.column,
                id: widget.id,
                file_name: fileName,
            })).widget.html);
        }
        if (widget && !widget.html) {
            loadHtml();
        } else {
            setHtml(widget && widget.html);
        }
    }, [fileName, widget, isVisible]);
    if (!widget) return null;
    async function post(e: any) {
        const message: WidgetEventRequest = {
            command: 'widget_event',
            line: widget.line,
            column: widget.column,
            id: widget.id,
            file_name: fileName,
            ...e,
        };
        const update_result = await global_server.send(message);
        if (!update_result.record) { return; }
        const record = update_result.record;
        if (record.status === 'success' && record.widget) {
            setHtml(record.widget.html);
        } else if (record.status === 'edit') {
            const loc = { line: widget.line, column: widget.column, file_name: fileName };
            if (onEdit) onEdit(loc, record.action);
            setHtml(record.widget.html);
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for ${message.handler}: invalid handler.`)
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message || record}`);
        }
    }
    return <div ref={node} className={isVisible ? 'ba b--red' : 'ba b--green'}><WidgetErrorBoundary>
        { html ? <ViewHtml html={html} post={post}/> : null }
    </WidgetErrorBoundary>
    </div>
}

interface HtmlProps {
    html: WidgetComponent;
    post: (e: WidgetEventRequest) => void;
}

function isWidgetElement(w: WidgetHtml): w is WidgetElement {
    return (typeof w === 'object') && (w as any).t;
}

function ViewHtml(props: {html: WidgetHtml; post}) {
    const {html, ...rest} = props;
    if (typeof html === 'string') {
        return html;
    } else if (!isWidgetElement(html)) {
        return ViewWidgetComponent({html, ...rest});
    } else {
        return ViewWidgetElement({ w:html, ...rest });
    }
}

function ViewWidgetElement(props: {w: WidgetElement; post}) {
    const {w, post, ...rest} = props;
    const { t:tag, c:children, tt:tooltip } = w;
    let { a:attributes, e:events } = w;
    if (tag === 'hr') { return <hr />; }
    attributes = attributes || {};
    events = events || {};
    const new_attrs: any = {};
    for (const k of Object.getOwnPropertyNames(attributes)) {
        new_attrs[k] = attributes[k];
    }
    for (const k of Object.getOwnPropertyNames(events)) {
        if (['onClick', 'onMouseEnter', 'onMouseLeave'].includes(k)) {
            new_attrs[k] = (e) => post({
                command: 'widget_event',
                kind: k as any,
                handler: events[k],
                args: { type: 'unit' }
            });
        } else if (((tag === 'input' && attributes.type === 'text') || tag === 'select') && k === 'onChange') {
            new_attrs.onChange = (e) => post({
                command: 'widget_event',
                kind: 'onChange',
                handler: events[k],
                args: { type: 'string', value: e.target.value }
            });
        } else {
            throw new Error(`unrecognised event kind ${k} for ${tag}`);
        }
    }
    const vs = children.map(html => ViewHtml({html, post, ...rest}));
    if (tooltip) {
        return <Popper popperContent={ViewHtml({ html: tooltip, post, ...rest })} refEltTag={tag} refEltAttrs={new_attrs} key={new_attrs.key}>
            {vs}
        </Popper>
    } else if (children.length > 0) {
        return React.createElement(tag, new_attrs, vs);
    } else {
        return React.createElement(tag, new_attrs);
    }
}

function ViewWidgetComponent(props: HtmlProps) {
    return props.html.c.map(html => ViewHtml({...props, html}))
}

