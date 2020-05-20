import { global_server, post, PositionEvent, ConfigEvent, SyncPinEvent } from './server';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { ServerStatus, Config, defaultConfig,  Location, locationKey, locationEq, DisplayMode } from '../src/typings';
import { Message } from 'lean-client-js-core';
import './tachyons.css' // stylesheet assumed by Lean widgets. See https://tachyons.io/ for documentation
import './index.css'
import { Info } from './info';
import { AllMessages } from './messages';


export const ConfigContext = React.createContext<Config>(defaultConfig);
export const MessagesContext = React.createContext<Message[]>([]);
export const LocationContext = React.createContext<Location | null>(null);

function StatusView(props: ServerStatus) {
    return <details open>
        <summary className="mv2 pointer">Tasks</summary>
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
    function onEdit(loc,text) {
        return post({
            command: 'insert_text',
            loc,
            text
        });
    }
    React.useEffect(() => {
        const me = global_server.allMessages.on(x => setMessages(x.msgs));
        const pe = PositionEvent.on(l => setCurLoc(l));
        const ce = ConfigEvent.on(l => setConfig({...config, ...l}));
        const de = SyncPinEvent.on(l => setPinnedLocs(l.pins));
        return () => {
            me.dispose();
            pe.dispose();
            ce.dispose();
            de.dispose();
        }
    });

    const isPinned = loc => pinnedLocs.some(l => locationEq(l, loc));
    const pin = () => {
        if (isPinned(curLoc)) {return; }
        const pins = [...pinnedLocs, curLoc];
        setPinnedLocs(pins);
        post({command:'sync_pin', pins})
    }
    const unpin = (idx) => () => {
        const pins = pinnedLocs.filter((l,i) => i !== idx);
        setPinnedLocs(pins);
        post({command:'sync_pin', pins})
    }

    return <div className="ma2">
        <ConfigContext.Provider value={config}><MessagesContext.Provider value={messages}>
            {pinnedLocs.map((l,i) => <Info loc={l} key={locationKey(l)} isPinned={true} isCursor={locationEq(l,curLoc)} onEdit={onEdit} onPin={unpin(i)}/>)}
            {!isPinned(curLoc) && <Info loc={curLoc} key="cursor" isPinned={false} isCursor={true} onEdit={onEdit} onPin={pin}/>}
            <details className={(config.displayMode === DisplayMode.AllMessage ? '' : 'dn')}>
                <summary className="mv2">All Messages</summary>
                <div className="ml3">
                    <AllMessages/>
                </div>
            </details>
        </MessagesContext.Provider></ConfigContext.Provider>
    </div>
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<Main/>, domContainer);
