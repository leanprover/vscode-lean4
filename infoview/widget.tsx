
import * as React from 'react';
import * as ReactPopper from 'react-popper';
import { WidgetEventMessage } from '../src/typings';
import "./popper.css"


/** This is everything that lean needs to know to figure out which event handler to fire in the VM. */
interface eventHandlerId {
    route: number[],
    handler: number,
}

interface element {
    tag: "div" | "span" | "hr" | "button" | "input", // ... etc
    children: html[],
    attributes: { [k: string]: any },
    events: {
        "onClick"?: eventHandlerId
        "onMouseEnter"?: eventHandlerId
        "onMouseLeave"?: eventHandlerId
    }
    tooltip?: html
}
type component = html[]

type html =
    | component
    | string
    | element
    | null

export interface WidgetProps {
    file_name: string,
    line: number,
    column: number,
    html: html[] | null,
    post : (e : WidgetEventMessage) => void
}

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
export function Widget(props: {widget? : string, post : WidgetProps["post"]}): JSX.Element {
    if (!props.widget) {return null; }
    let widget_json : WidgetProps = JSON.parse(props.widget);
    if (!widget_json) { return null; }
    widget_json.post = props.post;
    return <div>
        <h1>Widget</h1>
        <div className="widget-container">{Html(widget_json)}</div>
    </div>
}
function Html(props: WidgetProps) {
    let { html, ...rest } = props;
    return html.map(w => {
        if (typeof w === "string") { return w; }
        if (w instanceof Array) { return Html({ html: w, ...rest }); }
        let { tag, attributes, events, children, tooltip } = w;
        if (tag === "hr") { return <hr />; }
        attributes = attributes || {};
        events = events || {};
        let new_attrs: any = {};
        for (let k of Object.getOwnPropertyNames(attributes)) {
            new_attrs[k] = attributes[k];
        }
        for (let k of Object.getOwnPropertyNames(events)) {
            if (["onClick", "onMouseEnter", "onMouseLeave"].includes(k)) {
                new_attrs[k] = (e) => props.post({
                    command: "widget_event",
                    kind: k as any,
                    handler: events[k].handler,
                    route: events[k].route,
                    args: { type: "unit" },
                    file_name: props.file_name,
                    line: props.line,
                    column: props.column
                });
            } else if (tag === "input" && attributes.type === "text" && k === "onChange") {
                new_attrs["onChange"] = (e) => props.post({
                    command: "widget_event",
                    kind: "onChange",
                    handler: events[k].handler,
                    route: events[k].route,
                    args: { type: "string", value: e.target.value },
                    file_name: props.file_name,
                    line: props.line,
                    column: props.column,
                });
            } else {
                console.error(`unrecognised event kind ${k}`);
            }
        }
        if (tooltip) {
            return <Popper popperContent={Html({ html: [tooltip], ...rest })} refEltTag={tag} refEltAttrs={new_attrs} key={new_attrs.key}>{Html({ html: children, ...rest })}</Popper>
        } else if (children.length > 0) {
            return React.createElement(tag, new_attrs, Html({ html: children, ...rest }));
        } else {
            return React.createElement(tag, new_attrs);
        }
    });
}

