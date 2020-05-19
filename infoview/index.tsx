import { global_server, post } from './server';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { WidgetEventMessage, ToInfoviewMessage, ServerStatus, Config, defaultConfig, WidgetEventResponse, WidgetEventHandler, Location, WidgetComponent, locationKey, locationEq } from '../src/typings';
import { Widget } from './widget';
import { Message, Event } from 'lean-client-js-core';
import './tachyons.css'
import './index.css'
import { basename } from './util';
import { MessagesFor } from './messages';
import { Goal } from './goal';

interface InfoProps {
    loc: Location | null;
    isPinned: boolean;
    isCursor: boolean;
    onEdit: (l: Location, text: string) => void;
    onPin: (new_pin_state: boolean) => void;
}

export const ConfigContext = React.createContext<Config>(defaultConfig);
export const MessagesContext = React.createContext<Message[]>([]);
export const LocationContext = React.createContext<Location | null>(null);

function Info(props: InfoProps) {

    const {loc, isPinned, isCursor, onEdit, onPin} = props;
    const [widget, setWidget] = React.useState<{html: WidgetComponent | null} | null>(null);
    const [goalState, setGoalState] = React.useState(null);

    function updateInfo() {
        if (props.loc === null) {
            setWidget(null);
            setGoalState(null);
            return;
        }
        global_server.info(loc.file_name, loc.line, loc.column)
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

    async function handleWidgetEvent(e: {kind; handler: WidgetEventHandler; args}) {
        console.log('got widget event', e);
        if (props.loc === null) {
            updateInfo();
            return;
        }
        const message: WidgetEventMessage = {
            command: 'widget_event',
            ...props.loc,
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
            onEdit(props.loc, record.action);
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for ${message.handler}: invalid handler.`)
            updateInfo();
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message}`);
        }
    }

    if (loc === null) {
        return <div>Waiting for info... </div>
    }
    return <LocationContext.Provider value={loc}>
        <details className="ma1" open>
            <summary className="ma1 pa1">
                {`${basename(loc.file_name)}:${loc.line}:${loc.column}`}
                <span className="fr">
                    <a className="link pointer" onClick={() => onPin(!isPinned)}>{isPinned ? 'unpin' : 'pin'}</a>
                </span>
            </summary>
            <div className="ml1">
                <Widget widget={widget} post={e => handleWidgetEvent(e)} />
                <Goal goalState={goalState} />
                <MessagesFor loc={loc}/>
            </div>
        </details>
    </LocationContext.Provider>;
}

function StatusView(props: ServerStatus) {
    return <details open>
        <summary className="ma1 pa1">Tasks</summary>
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
    </details>
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

    const isPinned = loc => pinnedLocs.some(l => locationEq(l, loc));
    const pin = () => {
        if (isPinned(curLoc)) {return; }
        setPinnedLocs([...pinnedLocs, curLoc]);
    }
    const unpin = (idx) => () => {
        setPinnedLocs(pinnedLocs.filter((l,i) => i !== idx));
    }

    return <>
        <ConfigContext.Provider value={config}><MessagesContext.Provider value={messages}>
            {pinnedLocs.map((l,i) => <Info loc={l} key={locationKey(l)} isPinned={true} isCursor={locationEq(l,curLoc)} onEdit={onEdit} onPin={unpin(i)}/>)}
            {!isPinned(curLoc) && <Info loc={curLoc} key="cursor" isPinned={false} isCursor={true} onEdit={onEdit} onPin={pin}/>}
        </MessagesContext.Provider></ConfigContext.Provider>
    </>
}

const PositionEvent: Event<Location> = new Event();
const ConfigEvent: Event<Config> = new Event();

window.addEventListener('message', event => { // messages from the extension
    const message: ToInfoviewMessage = event.data; // The JSON data our extension sent
    console.log('Recieved from extension:', message);
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
