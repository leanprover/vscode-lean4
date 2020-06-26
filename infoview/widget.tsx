import * as React from 'react';
import * as ReactPopper from 'react-popper';
import './popper.css';
import { WidgetComponent, WidgetHtml, WidgetElement, WidgetEventRequest, WidgetIdentifier, WidgetData } from 'lean-client-js-node';
import { global_server, postInsertText, postReveal, postHighlightPosition, postClearHighlight } from './server';
import { Location } from '../src/shared';
import { useIsVisible } from './collapsing';

function Popper(props: {children: React.ReactNode[]; popperContent: any; refEltTag: any; refEltAttrs: any}) {
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
    fileName: string;
}

class WidgetErrorBoundary extends React.Component<{children: any},{error?: {message: string}}> {
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

/** [todo] pending adding to lean-client-js */
export type WidgetEffect =
| {kind: 'insert_text'; text: string}
| {kind: 'reveal_position'; file_name: string; line: number; column: number}
| {kind: 'highlight_position'; file_name: string; line: number; column: number}
| {kind: 'clear_highlighting'}
| {kind: 'custom'; key: string; value: string}

function applyWidgetEffect(widget: WidgetIdentifier, file_name: string, effect: WidgetEffect) {
    switch (effect.kind) {
        case 'insert_text':
            const loc = {file_name, line: widget.line, column: widget.column};
            postInsertText(loc, effect.text);
            break;
        case 'reveal_position': postReveal(effect); break;
        case 'highlight_position': postHighlightPosition(effect); break;
        case 'clear_highlighting': postClearHighlight(); break;
        case 'custom':
            console.log(`Custom widget effect: ${effect.key} -- ${effect.value}`);
            break;
        default:
            break;
    }
}

export function Widget({ widget, fileName }: WidgetProps): JSX.Element {
    const [html, setHtml] = React.useState<WidgetComponent>();
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
            const effects: WidgetEffect[] | undefined = (record as any).effects;
            if (effects) {
                for (const effect of effects) {
                    applyWidgetEffect(widget, fileName, effect);
                }
            }
            setHtml(record.widget.html);
        } else if (record.status === 'edit') {
            // @deprecated case
            const loc = { line: widget.line, column: widget.column, file_name: fileName };
            postInsertText(loc, record.action);
            setHtml(record.widget.html);
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for ${message.handler}: invalid handler.`)
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message || record}`);
        }
    }
    return <div ref={node}>
        <WidgetErrorBoundary>
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

