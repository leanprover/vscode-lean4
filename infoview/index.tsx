import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactPopper from 'react-popper';
import {WidgetEventMessage} from '../src/typings';

// @ts-ignore
const vscode = acquireVsCodeApi();

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

type widget = {
    file_name: string,
    line: number,
    column: number,
    html: html[] | null
}

function Html(props: widget) {
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
                new_attrs[k] = (e) => post({
                        command: "widget_event",
                        kind: k as any,
                        handler: events[k].handler,
                        route: events[k].route,
                        args: {type : "unit"},
                        file_name: props.file_name,
                        line: props.line,
                        column: props.column
                    });
            } else if (tag === "input" && attributes.type === "text" && k === "onChange") {
                new_attrs["onChange"] = (e) => post({
                    command : "widget_event",
                    kind : "onChange",
                    handler : events[k].handler,
                    route : events[k].route,
                    args : {type : "string", value : e.target.value},
                    file_name : props.file_name,
                    line : props.line,
                    column : props.column,
                });
            } else {
                console.error(`unrecognised event kind ${k}`);
            }
        }
        if (tooltip) {
            return <Popper popperContent={Html({html:[tooltip], ...rest})} refEltTag={tag} refEltAttrs={new_attrs} key={new_attrs.key}>{Html({html:children, ...rest})}</Popper>
        } else if (children.length > 0) {
            return React.createElement(tag, new_attrs, Html({ html: children, ...rest }));
        } else {
            return React.createElement(tag, new_attrs);
        }
    });
}

const Popper = (props) => {
    const { children, popperContent, refEltTag, refEltAttrs } = props;
    const [referenceElement, setReferenceElement] = React.useState(null);
    const [popperElement, setPopperElement] = React.useState(null);
    const [arrowElement, setArrowElement] = React.useState(null);
    const { styles, attributes } = ReactPopper.usePopper(referenceElement, popperElement, {
        modifiers: [
            { name: 'arrow', options: { element: arrowElement } },
            { name: 'offset', options : {offset : [0,8]}}
        ],
    });
    const refElt = React.createElement(refEltTag, {ref : setReferenceElement, ...refEltAttrs}, children);
    return (
        <>
            {refElt}
            <div ref={setPopperElement} style={styles.popper} {...attributes.popper} className="tooltip">
                {popperContent}
                <div ref={setArrowElement} style={styles.arrow} className="arrow"/>
            </div>
        </>
    );
}
function Widget(props: { widget?: string }) : JSX.Element {
        let { widget } = props;
        let widget_json = JSON.parse(widget);
        if (!widget_json) { return null; }
        return <div id="widget">
            <h1>Widget</h1>
            <div className="widget-container">{Html(widget_json)}</div>
        </div>
    }

// [hack] copied from commands.d.ts
interface LogMessage {
    file_name: string;
    pos_line: number;
    pos_col: number;
    end_pos_line?: number;
    end_pos_col?: number;
    severity: 'information' | 'warning' | 'error';
    caption: string;
    text: string;
}

enum DisplayMode { // [hack] copied
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}


interface InfoProps {
    widget?: string,
    goalState?: string,
    messages?: LogMessage[],

    fileName: string,

    displayMode: DisplayMode,
    infoViewTacticStateFilters: any[],
    filterIndex
}

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function colorizeMessage(goal: string): string {
    return goal
        .replace(/^([|⊢]) /mg, '<strong class="goal-vdash">$1</strong> ')
        .replace(/^(\d+ goals|1 goal)/mg, '<strong class="goal-goals">$1</strong>')
        .replace(/^(context|state):/mg, '<strong class="goal-goals">$1</strong>:')
        .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
        .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :');
}

function basename(path) { return path.split(/[\\/]/).pop(); }

function Goal(props) : JSX.Element {
    if (!props.goalState || props.displayMode !== DisplayMode.OnlyState) { return null; }
    const reFilters = props.infoViewTacticStateFilters || [];
    const filterIndex = props.infoViewFilterIndex ?? -1;
    let goalString = props.goalState.replace(/^(no goals)/mg, 'goals accomplished')
    goalString = RegExp('^\\d+ goals|goals accomplished', 'mg').test(goalString) ? goalString : '1 goal\n'.concat(goalString);
    if (!(reFilters.length === 0 || filterIndex === -1)) {
        // this regex splits the goal state into (possibly multi-line) hypothesis and goal blocks
        // by keeping indented lines with the most recent non-indented line
        goalString = goalString.match(/(^(?!  ).*\n?(  .*\n?)*)/mg).map((line) => line.trim())
            .filter((line) => {
                const filt = reFilters[filterIndex];
                const test = line.match(new RegExp(filt.regex, filt.flags)) !== null;
                return filt.match ? test : !test;
            }).join('\n');
    }
    goalString = colorizeMessage(escapeHtml(goalString));
    return <div id="goal">
        <h1>Tactic State</h1>
        <pre className="font-code" dangerouslySetInnerHTML={{ __html: goalString }} />
    </div>
}

function Messages(props: InfoProps) : JSX.Element {
    if (!props.fileName || !props.messages) { return null; }
    let msgs = props.messages.map((m) => {
        const f = escapeHtml(m.file_name);
        const b = escapeHtml(basename(m.file_name));
        const l = m.pos_line; const c = m.pos_col;
        const el = m.end_pos_line || l;
        const ec = m.end_pos_col || c;
        const cmd = encodeURI('command:_lean.revealPosition?' +
            // JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
            JSON.stringify([(m.file_name), m.pos_line, m.pos_col])); // [TODO] Uri.file isn't available in the webview?
        const shouldColorize = m.severity === 'error';
        let text = escapeHtml(m.text)
        text = shouldColorize ? colorizeMessage(text) : text;
        let key = `${m.file_name}:${m.pos_line}:${m.pos_col}`;
        return <div key={key} className={`message ${m.severity}`} data-line={l} data-column={c} data-end-line={el} data-end-column={ec}>
            <h1 title={`${f}:${l}:${c}`}>
                <a href={cmd}>
                    {b}:{l}:{c}: {m.severity} {escapeHtml(m.caption)}
                </a>
            </h1>
            <pre className="font-code" dangerouslySetInnerHTML={{ __html: text }} />
        </div>;
    });
    return <div id="messages">{msgs}</div>
}

function Info(props: InfoProps) {
    return <>
        <div id="run-state">
            <span id="state-continue">
                <a href="command:_lean.infoView.continue?{}">
                    <img title="Unfreeze display" src="continue.svg" />
                </a>
            </span>
            <span id="state-pause">
                <a href="command:_lean.infoView.pause?{}">
                    <img title="Freeze display" src="pause.svg" />
                </a>
            </span>
        </div>
        <Widget {...props} />
        <Goal {...props} />
        <Messages {...props} />
    </>
}

window.addEventListener('message', event => {

    const message = event.data; // The JSON data our extension sent
    console.log("incoming:", message);
    switch (message.command) {
        case 'sync':
            ReactDOM.render(React.createElement(Info, message.props), domContainer);
            break;
        default:
            console.error(`Unrecognised command ${message.command}`);
    }
});


function post(message : WidgetEventMessage) {
    console.log("posting:", message);
    vscode.postMessage(message);
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<div><h1>Lean Interactive Window</h1></div>, domContainer);
