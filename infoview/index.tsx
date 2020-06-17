import { global_server, post, PositionEvent, ConfigEvent, SyncPinEvent, PauseEvent, ContinueEvent, ToggleUpdatingEvent, TogglePinEvent } from './server';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { ServerStatus, Config, defaultConfig,  Location, locationKey, locationEq } from '../src/shared';
import { Message } from 'lean-client-js-core';
import './tachyons.css' // stylesheet assumed by Lean widgets. See https://tachyons.io/ for documentation
import './index.css'
import { Info } from './info';
import { Messages, processMessages } from './messages';

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

interface InfoProps {
    loc?: Location;
    paused: boolean;
}

function Main(props: {}) {
    if (!props) { return null }
    const [config, setConfig] = React.useState(defaultConfig);
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [curLoc, setCurLoc] = React.useState<InfoProps>({paused: false});
    const [pinnedLocs, setPinnedLocs] = React.useState<InfoProps[]>([]);
    const setPause = (idx?: number) => (paused: boolean) => {
        if (idx === undefined) {
            setCurLoc({...curLoc, paused});
        } else {
            const pins = [...pinnedLocs];
            pins[idx] = {...pins[idx], paused};
            setPinnedLocs(pins);
        }
    }
    function onEdit(loc: Location, text: string) {
        return post({
            command: 'insert_text',
            loc,
            text
        });
    }
    React.useEffect(() => {
        const subscriptions = [
            global_server.allMessages.on(x => setMessages(x.msgs)),
            PositionEvent.on(loc => setCurLoc({...curLoc, loc})),
            ConfigEvent.on(l => setConfig(l)),
            SyncPinEvent.on(l => setPinnedLocs(l.pins.map((loc, i) => ({loc, paused: pinnedLocs[i] && pinnedLocs[i].paused})))),
            PauseEvent.on(l => setPause()(true)),
            ContinueEvent.on(l => setPause()(false)),
            ToggleUpdatingEvent.on(l => setPause()(curLoc && !curLoc.paused)),
            TogglePinEvent.on(() => isPinned(curLoc.loc) ? unpin()() : pin() )
        ];
        return () => { for (const s of subscriptions) s.dispose(); }
    });
    const isPinned = (loc: Location) => pinnedLocs.some(l => locationEq(l.loc, loc));
    const pin = () => {
        if (isPinned(curLoc.loc)) {return; }
        const pins = [...pinnedLocs, curLoc];
        setPinnedLocs(pins);
        post({command:'sync_pin', pins: pins.map(x => x.loc)})
    }
    const unpin = (idx?) => () => {
        if (idx === undefined) {
            idx = pinnedLocs.findIndex(p => locationEq(p.loc, curLoc.loc));
        }
        const pins = pinnedLocs.filter((l,i) => i !== idx);
        setPinnedLocs(pins);
        post({command:'sync_pin', pins: pins.map(x => x.loc)})
    }
    const allMessages = processMessages(messages, null);
    return <div className="ma1">
        <ConfigContext.Provider value={config}><MessagesContext.Provider value={messages}>
            {pinnedLocs.map(({loc, paused},i) => {
                const isCursor = locationEq(loc,curLoc.loc);
                return <Info loc={loc} isPaused={paused} setPaused={setPause(i)} key={i} isPinned={true} isCursor={isCursor} onEdit={onEdit} onPin={unpin(i)}/>}) }
            {!isPinned(curLoc.loc) && <Info loc={curLoc.loc} isPaused={curLoc.paused} setPaused={setPause()} key={pinnedLocs.length} isPinned={false} isCursor={true} onEdit={onEdit} onPin={pin}/>}
            <details>
                <summary className="mv2">All Messages ({allMessages.length})</summary>
                <div className="ml1">
                    <Messages messages={allMessages}/>
                </div>
            </details>
        </MessagesContext.Provider></ConfigContext.Provider>
    </div>
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<Main/>, domContainer);
