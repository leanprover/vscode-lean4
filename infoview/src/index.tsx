
// import { basename } from 'path'

declare var React;
declare var ReactDOM;

type widget = ({ tag: string, children: widget, attributes: { [k: string]: any } } | string)[]

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

enum DisplayMode { //[hack] copied
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

function Goal(props) {
    // hello
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
    return props.messages.map((m) => {
        const f = escapeHtml(m.file_name);
        const b = escapeHtml(m.file_name); // [hack] should be basename
        const l = m.pos_line; const c = m.pos_col;
        const el = m.end_pos_line || l;
        const ec = m.end_pos_col || c;
        const cmd = encodeURI('command:_lean.revealPosition?' +
            // JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
            JSON.stringify([(m.file_name), m.pos_line, m.pos_col]));
        const shouldColorize = m.severity === 'error';
        let text = escapeHtml(m.text)
        text = shouldColorize ? this.colorizeMessage(text) : text;
        this.messageFormatters.forEach((formatter) => {
            text = formatter(text, m);
        });
        return <div className={`message ${m.severity}`} data-line={l} data-column={c} data-end-line={el} data-end-column={ec}>
            <h1 title={`${f}:${l}:${c}`}>
                <a href={cmd}>
                    {b}:{l}:{c}: {m.severity} {escapeHtml(m.caption)}
                </a>
            </h1>
            <pre dangerouslySetInnerHTML={{ __html: text }} />
        </div>;
    }).join('\n');
}

/** Render a Lean widget */
function Widget(props : {widget? : widget}) {
    let {widget, ...rest} = props;
    if (!widget) {return "";}
    return widget.map(w => {
        if (typeof w === "string") {   return w; }
        let {tag, attributes, children} = w;
        attributes = attributes || {};
        let new_attrs : any = {};
        for (let k of Object.getOwnPropertyNames(attributes)) {
            if (k === "onClick") {
                new_attrs[k] = () => vscode.postMessage({
                    command: "widget-event",
                    handler: attributes[k],
                    args : {}, // [todo]
                });
            } else {
                new_attrs[k] = attributes[k];
            }
        }
        return React.createElement(tag, new_attrs, <Widget widget={children} {...rest}/>)
    })
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

function Counter() {
    const [count, setCount] = React.useState(0);
    return [
        React.createElement('button', { onClick: () => setCount(count + 1) }, "+"),
        count,
        React.createElement('button', { onClick: () => setCount(count - 1) }, "-"),
    ]
}

// @ts-ignore
const vscode = acquireVsCodeApi();

window.addEventListener('message', event => {

    const message = event.data; // The JSON data our extension sent
    console.log(message);
    switch (message.command) {
        case 'sync':
            ReactDOM.render(React.createElement(Info, message.props), domContainer);
            break;
        default:
            console.error(`Unrecognised command ${message.command}`);
    }
});

const domContainer = document.querySelector('#react_root');
ReactDOM.render(React.createElement(Counter), domContainer);