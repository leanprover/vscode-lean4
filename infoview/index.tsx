import { post, PositionEvent, ConfigEvent, SyncPinEvent, TogglePinEvent, AllMessagesEvent, currentAllMessages, currentConfig, globalCurrentLoc } from './server';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { ServerStatus, Config, defaultConfig,  Location, locationEq, PinnedLocation } from '../src/shared';
import { Message } from 'lean-client-js-core';
import './tachyons.css' // stylesheet assumed by Lean widgets. See https://tachyons.io/ for documentation
import './index.css'
import { Info } from './info';
import { Messages, processMessages } from './messages';
import { Details } from './collapsing';

export const ConfigContext = React.createContext<Config>(defaultConfig);
export const LocationContext = React.createContext<Location | null>(null);

function StatusView(props: ServerStatus) {
    return <Details>
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
    </Details>
}

function Main(props: {}) {
    if (!props) { return null }
    const [config, setConfig] = React.useState(currentConfig);
    const [messages, setMessages] = React.useState<Message[]>(currentAllMessages);
    const [curLoc, setCurLoc] = React.useState<Location>(globalCurrentLoc);
    React.useEffect(() => {
        const subscriptions = [
            AllMessagesEvent.on(x => setMessages(x)),
            PositionEvent.on(loc => setCurLoc(loc)),
            ConfigEvent.on(l => setConfig(l)),
        ];

        return () => { for (const s of subscriptions) s.dispose(); }
    }, []);
    if (!curLoc) return <p>Click somewhere in the Lean file to enable the info view.</p>;
    const allMessages = processMessages(messages.filter((m) => curLoc && m.file_name === curLoc.file_name));
    return <div className="ma1">
        <ConfigContext.Provider value={config}>
            <Infos curLoc={curLoc}/>
            <div className="mv2"><AllMessages allMessages={allMessages}/></div>
        </ConfigContext.Provider>
    </div>
}

function Infos({curLoc}: {curLoc: Location}): JSX.Element {
    React.useEffect(() => {
        const subscriptions = [
            SyncPinEvent.on(l => setPinnedLocs(l.pins)),
            TogglePinEvent.on(() => isPinned(curLoc) ? unpin()() : pin() )
        ];

        return () => { for (const s of subscriptions) s.dispose(); }
    }, []);
    const [pinnedLocs, setPinnedLocs] = React.useState<PinnedLocation[]>([]);
    const isPinned = (loc: Location) => pinnedLocs.some((l) => locationEq(l, loc));
    const pinKey = React.useRef<number>(0);
    const pin = () => {
        if (isPinned(curLoc)) {return; }
        pinKey.current += 1;
        const pins = [...pinnedLocs, { ...curLoc, key: pinKey.current }];
        setPinnedLocs(pins);
        post({command:'sync_pin', pins});
    }
    const unpin = (key?: number) => () => {
        if (key === undefined) {
            const pinned = pinnedLocs.find(p => locationEq(p, curLoc));
            if (pinned) {
                key = pinned.key;
            } else {
                return;
            }
        }
        const pins = pinnedLocs.filter((l) => l.key !== key);
        setPinnedLocs(pins);
        post({command:'sync_pin', pins});
    }
    return <>
        <div>
            {pinnedLocs.map((loc) =>
                <Info key={loc.key} loc={loc} isPinned={true} isCursor={false} onPin={unpin(loc.key)}/>)}
        </div>
        <Info loc={curLoc} isPinned={false} isCursor={true} onPin={pin}/>
    </>;
}

function AllMessages({allMessages}): JSX.Element {
    const config = React.useContext(ConfigContext);
    return <Details open={!config.infoViewAutoOpenShowGoal}>
        <summary>All Messages ({allMessages.length})</summary>
        <div className="ml1"> <Messages messages={allMessages}/> </div>
    </Details>;
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<Main/>, domContainer);
