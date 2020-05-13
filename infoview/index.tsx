import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { WidgetEventMessage, DisplayMode, InfoProps, InfoViewState, ToInfoviewMessage, ServerStatus, FromInfoviewMessage, Config } from '../src/typings';
import { Widget } from './widget';
import { Message } from 'lean-client-js-node';
import './tachyons.css'
import './index.css'
import { colorizeMessage, escapeHtml, basename, Collapsible } from './util';
import { MessagesFor } from './messages';
declare const acquireVsCodeApi;
const vscode = acquireVsCodeApi();

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
    return <Collapsible title="Tactic State">
        <pre className="font-code" dangerouslySetInnerHTML={{ __html: goalString }} />
    </Collapsible>
}

function Info(props: InfoProps & {is_pinned: boolean; messages: Message[]; config: Config}) {
    // let col = props.color || "lightest-blue";
    const toolbar = <>
        <a onClick={() => post({
            command : 'set_pin',
            file_name : props.file_name,
            line : props.line,
            column : props.column,
        })}>pin</a>
    </>;
    return <Collapsible title={`${props.base_name}:${props.line}:${props.column}`}>
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
        <div>
            <Widget widget={props.widget} post={e => post(e)}/>
            <Goal {...props} />
            <MessagesFor {...props} config={props.config} />
            {!props.goalState && (!props.messages || props.messages.length === 0) && (!props.widget) ? 'no info found' : null}
        </div>
    </Collapsible>
}

function StatusView(props: ServerStatus) {
    return <Collapsible title="Tasks">
        <p>Running: {props.isRunning}</p>
        <table> <tbody>
            <tr key="header"><th>File Name</th>
            <th>Pos start</th>
            <th>Pos end</th>
            <th>Desc</th></tr>
            {props.tasks.map(t => <tr key={`${t.file_name}:${t.pos_col}:${t.pos_line}:${t.desc}`}>
                <td>{t.file_name}</td>
                <td>{t.pos_line}:{t.pos_col}</td>
                <td>{t.end_pos_line}:{t.end_pos_col}</td>
                <td>{t.desc}</td>
            </tr>)}
        </tbody>
        </table>
        </Collapsible>
}

function Main(props: InfoViewState) {
    if (!props) {return null}
    return <>
        <Info {...props.cursorInfo} key="cursor" is_pinned={false} config={props.config} messages={props.messages}/>
        {props.pinnedInfos && props.pinnedInfos.map (pi =>
          <Info {...props.cursorInfo} key={pi.location_name} is_pinned={true} config={props.config} messages={props.messages}/>)}
        {/* {props.serverStatus && <StatusView {...props.serverStatus}/>} */}
    </>
}

let global_state: Partial<InfoViewState> = {}

window.addEventListener('message', event => {
    const message: ToInfoviewMessage = event.data; // The JSON data our extension sent
    console.log('incoming:', message);
    switch (message.command) {
        case 'sync':
            global_state = {...global_state, ...message.props};
            ReactDOM.render(React.createElement(Main, global_state), domContainer);
            break;
        default:
            console.error(`Unrecognised command ${message.command}`);
    }
});

function post(message: FromInfoviewMessage) {
    console.log('posting:', message);
    vscode.postMessage(message);
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<div><h1>Lean Interactive Window</h1>Waiting for message from server...</div>, domContainer);
