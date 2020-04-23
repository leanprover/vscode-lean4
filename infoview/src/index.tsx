declare var React;
declare var ReactDOM;

/** This is everything that lean needs to know to figure out which event handler to fire in the VM. */
interface eventHandlerId {
    route : number[],
    handler : number,
}

type html =
    | { tag: "div" | "span" | "hr", children: html[], attributes: { [k: string]: any }, events : {[k : string] : eventHandlerId} }
    | string
    | { tag : "Hover", hoverThunk : number, children : html[] }


type widget = {
    file_name : string,
    line : number,
    column : number,
    html : html[]
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
    widget?: widget,
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

function basename(path) {return path.split(/[\\/]/).pop();}

function Goal(props) {
    if (!props.goalState || props.displayMode !== DisplayMode.OnlyState) { return []; }
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
        <pre dangerouslySetInnerHTML={{ __html: goalString }} />
    </div>
}

function Messages(props: InfoProps) {
    if (!props.fileName || !props.messages) { return ``; }
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
            <pre dangerouslySetInnerHTML={{ __html: text }} />
        </div>;
    });
    return <div id="messages">{msgs}</div>
}

function Hover(props : {handler: number, children}) {

}

function Html(props : widget) {
    let {html, ...rest} = props;
    return html.map(w => {
        if (typeof w === "string") {   return w; }
        if (w.tag === "Hover") {

            return;
        }
        let {tag, attributes, events, children} = w;

        if (tag === "hr") { return <hr/>; }
        attributes = attributes || {};
        events = events || {};
        let new_attrs : any = {};
        for (let k of Object.getOwnPropertyNames(attributes)) {
            new_attrs[k] = attributes[k];

        }
        for (let k of Object.getOwnPropertyNames(events)) {
            let eh = events[k];
            if (k === "onClick") {
                new_attrs[k] = () => post({
                    command: "widget_event",
                    kind : "click",
                    handler: eh.handler,
                    route : eh.route,
                    args : {}, // [todo]
                    file_name : props.file_name,
                    line : props.line,
                    column : props.column
                });
            } else {
                console.error(`unrecognised event kind ${k}`);
            }
        }
        return React.createElement(tag, new_attrs, Html({html:children, ...rest}));
    })
}

function Widget(props : {widget? : widget}) {
    let {widget, ...rest} = props;
    if (!widget) {return "";}
    return <div id="widget">
        <h1>Widget</h1>
        <div className="widget-container">{Html(widget)}</div>;
    </div>
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
        <Goal {...props}/>
        <Messages {...props}/>
        <Widget {...props}/>
    </>
}

// @ts-ignore
const vscode = acquireVsCodeApi();

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

function post(message) {
    console.log("posting:", message);
    vscode.postMessage(message);
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<div><h1>Lean Interactive Window</h1></div>, domContainer);

/* todos:

- [ ] sort out button images / images in general.
- [ ] make sure that the types are DRY between extension and webview
- [ ] figure out tsc error:
        ../node_modules/@types/semver/ranges/valid.d.ts:2:25 - error TS2307: Cannot find module '../'.
- [ ] styling; can I include a stylesheet so that it is easy to make things look good?
- [ ] it is possible that the widget's update function will take too long, in which case we should show some kind of loading thing.
- [ ] tooltips / hover information is common enough that they should be supported 'natively'
- [ ] a reset button for a widget.
- [ ] drag and drop.

*/