import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { WidgetEventMessage, DisplayMode, InfoProps, InfoViewState, InfoviewMessage } from '../src/typings';
import { Widget } from './widget';
import { Message } from 'lean-client-js-node';

// @ts-ignore
const vscode = acquireVsCodeApi();

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


function Collapsable(props : {title : string, children, className?}) {
    const [collapsed, set] = React.useState(false);
    return <div className={props.className}>
        <h1 className="flex justify-between items-end"><span>{props.title}</span><button className="pointer dim f4 link pa1 ma1 bn bg-transparent" onClick={() => set(!collapsed)}>{collapsed ? "▶" : "▼"}</button></h1>
        <div hidden={collapsed}>
            {props.children}
        </div>
    </div>
}

function Goal(props): JSX.Element {
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
    return <Collapsable title="Tactic State">
        <pre className="font-code" dangerouslySetInnerHTML={{ __html: goalString }} />
    </Collapsable>
}

function MessageView(m : Message) {
    // const f = escapeHtml(m.file_name);
    const b = escapeHtml(basename(m.file_name));
    const l = m.pos_line; const c = m.pos_col;
    // const el = m.end_pos_line || l;
    // const ec = m.end_pos_col || c;
    // const cmd = encodeURI('command:_lean.revealPosition?' +
        // JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
        // JSON.stringify([(m.file_name), m.pos_line, m.pos_col])); // [TODO] Uri.file isn't available in the webview?
    const shouldColorize = m.severity === 'error';
    let text = escapeHtml(m.text)
    text = shouldColorize ? colorizeMessage(text) : text;
    return <Collapsable title={`${b}:${l}:${c}`}>
        <pre className="font-code" dangerouslySetInnerHTML={{ __html: text }} />
    </Collapsable>
    // return <div className={`message ${m.severity}`} data-line={l} data-column={c} data-end-line={el} data-end-column={ec}>
    //     <h1 title={`${f}:${l}:${c}`}>
    //         <a href={cmd}>
    //             {b}:{l}:{c}: {m.severity} {escapeHtml(m.caption)}
    //         </a>
    //     </h1>
    //     <pre className="font-code" dangerouslySetInnerHTML={{ __html: text }} />
    // </div>;
}

function Messages(props: InfoProps): JSX.Element {
    if (!props.fileName || !props.messages) { return null; }
    let msgs = props.messages.map(m => <MessageView {...m} key={m.file_name + m.pos_line + m.pos_col + m.caption}/>);
    return <Collapsable title="Messages">{msgs}</Collapsable>
}

function Info(props: InfoProps & {color? : "light-blue" | "light-green"}) {
    let col = props.color || "lightest-blue";
    return <div className={`ba ma2 b--${col}`}>
        <h1 className={`bg-${col} f5 pv2 ph3 ma0 bn`}>{props.base_name}:{props.line}:{props.column}</h1>
        {/* <div id="run-state">
            <span id="state-continue">
                <button onClick={() => setFrozen(null)}><img title="Unfreeze display" src="continue.svg" /></button>
            </span>
            <span id="state-pause">
                <button onClick={() => setFrozen(this.props)}>
                    <img title="Freeze display" src="pause.svg" />
                </button>
            </span>
        </div> */}
        <div className="pa3 ma0">
            <Widget widget={props.widget} post={e => post(e)}/>
            <Goal {...props} />
            <Messages {...props} />
        </div>
    </div>
}

function Main(props : InfoViewState) {
    if (!props) {return null}
    return <>
        <Info {...props.cursorInfo} key="cursor"/>
        {props.pinnedInfos && props.pinnedInfos.map (pi => <Info {...props.cursorInfo} key={pi.key}/>)}
    </>
}

window.addEventListener('message', event => {
    const message : InfoviewMessage = event.data; // The JSON data our extension sent
    console.log("incoming:", message);
    switch (message.command) {
        case 'sync':
            ReactDOM.render(React.createElement(Main, message.props), domContainer);
            break;
        default:
            console.error(`Unrecognised command ${message.command}`);
    }
});

function post(message: WidgetEventMessage) {
    console.log("posting:", message);
    vscode.postMessage(message);
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<div><h1>Lean Interactive Window</h1></div>, domContainer);
