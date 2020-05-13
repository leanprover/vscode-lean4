import { global_server, post } from './server';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { WidgetEventMessage, DisplayMode, Location, InfoViewState, ToInfoviewMessage, ServerStatus, FromInfoviewMessage, Config, defaultConfig, locationKey, WidgetEventResponse } from '../src/typings';
import { Widget } from './widget';
import { Message, Event } from 'lean-client-js-node';
import './tachyons.css'
import './index.css'
import { Collapsible, basename } from './util';
import { MessagesFor } from './messages';
import { Goal } from './goal';

interface InfoProps {
    loc: Location;
    isPinned: boolean;
    onEdit: (l: Location, text: string) => void;
}

export const ConfigContext = React.createContext<Config>(defaultConfig);
export const MessagesContext = React.createContext<Message[]>([]);

function Info(props: InfoProps) {
    const [widget, setWidget] = React.useState(null);
    const [goalState, setGoalState] = React.useState(null);

    function updateInfo() {
        global_server.info(props.loc.file_name, props.loc.line, props.loc.column)
            .then((info) => {
                const record: any = info.record;
                if (record && record.widget) {
                    setWidget(record.widget);
                }
                if (record && record.state) {
                    setGoalState(record.state);
                }
            });
    }

    React.useEffect(() => updateInfo(), [props.loc]);

    async function handleWidgetEvent(e: {kind; handler; route; args}) {
        console.log('got widget event', e);
        const message: WidgetEventMessage = {
            command: 'widget_event',
            loc: props.loc,
            ...e,
        }
        const result: any = await global_server.send(message);
        console.log('received from server', result);
        if (!result.record) { return; }
        const record: WidgetEventResponse = result.record;
        if (record.status === 'success' && record.widget) {
            setWidget(record.widget);
        } else if (record.status === 'edit') {
            setWidget(record.widget);
            this.props.onEdit(props.loc, record.action);
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for {${message.handler}, ${message.route}}: invalid handler.`)
            updateInfo();
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message}`);
        }
    }

    const toolbar = props.isPinned ? <a onClick={() => {}}>unpin</a> : <a onClick={() => { }}>pin</a>;
    return <Collapsible title={`${basename(props.loc.file_name)}:${props.loc.line}:${props.loc.column}`} toolbar={toolbar}>
        <Widget widget={widget} post={e => handleWidgetEvent(e)} />
        <Goal goalState={goalState} />
        <MessagesFor loc={props.loc} />
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

function Main(props: {}) {
    if (!props) { return null }
    const [config, setConfig] = React.useState(defaultConfig);
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [curLoc, setCurLoc] = React.useState<Location | null>(null);
    const [pinnedLocs, setPinnedLocs] = React.useState<Location[]>([]);
    React.useEffect(() => {
        const me = global_server.allMessages.on(x => setMessages(x.msgs));
        const pe = PositionEvent.on(l => setCurLoc(l));
        const ce = ConfigEvent.on(l => setConfig(l));
        return () => {
            me.dispose();
            pe.dispose();
            ce.dispose();
        }
    });

    function onEdit(loc,text) {
        return post({
            command: 'insert_text',
            loc,
            text
        });
    }

    return <>
        <ConfigContext.Provider value={config}><MessagesContext.Provider value={messages}>
            <Info loc={curLoc} key="cursor" isPinned={false} onEdit={onEdit}/>
            {pinnedLocs.map((l,i) => <Info loc={l} key={i} isPinned={true} onEdit={onEdit}/>)}
        </MessagesContext.Provider></ConfigContext.Provider>
    </>
}

const PositionEvent: Event<Location> = new Event();
const ConfigEvent: Event<Config> = new Event();

window.addEventListener('message', event => { // messages from the extension
    const message: ToInfoviewMessage = event.data; // The JSON data our extension sent
    switch (message.command) {
        case 'position':
            PositionEvent.fire(message.loc);
            break;
        case 'on_config_change':
            ConfigEvent.fire(message.config);
            break;
    }
});

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<Main/>, domContainer);
