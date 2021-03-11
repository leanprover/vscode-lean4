import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Config, defaultConfig, InfoviewLocation, locationEq, Message, PinnedLocation } from '../src/infoviewApi';
import './tachyons.css' // stylesheet assumed by Lean widgets. See https://tachyons.io/ for documentation
import './index.css'
import { Info } from './info';
import { Messages, processMessages, ProcessedMessage } from './messages';
import { Details } from './collapsing';
import { useEvent } from './util';
import { ContinueIcon, PauseIcon } from './svg_icons';
import { allMessagesEvent, configEvent, position as positionEvent, syncPins, syncPinsEvent, toggleAllMessagesEvent, togglePinEvent } from './server';

export const ConfigContext = React.createContext<Config>(defaultConfig);
export const LocationContext = React.createContext<InfoviewLocation | null>(null);

function Main(props: {}) {
    if (!props) { return null }
    const [config, setConfig] = React.useState(configEvent.current);
    const [messages, setMessages] = React.useState<Message[]>(allMessagesEvent.current);
    const [curLoc, setCurLoc] = React.useState<InfoviewLocation>(positionEvent.current);
    useEvent(allMessagesEvent, (msgs) => setMessages(msgs), []);
    useEvent(positionEvent, (loc) => setCurLoc(loc), []);
    useEvent(configEvent, (cfg) => setConfig(cfg), []);
    if (!curLoc) return <p>Click somewhere in the Lean file to enable the info view.</p>;
    const allMessages = processMessages(messages.filter((m) => curLoc && m.uri === curLoc.uri));
    return <div className="ma1">
        <ConfigContext.Provider value={config}>
            <Infos curLoc={curLoc}/>
            <div className="mv2"><AllMessages allMessages={allMessages}/></div>
        </ConfigContext.Provider>
    </div>
}

function Infos({curLoc}: {curLoc: InfoviewLocation}): JSX.Element {
    useEvent(syncPinsEvent, (pins) => setPinnedLocs(pins), []);
    useEvent(togglePinEvent, () => isPinned(curLoc) ? unpin()() : pin());
    const [pinnedLocs, setPinnedLocs] = React.useState<PinnedLocation[]>([]);
    const isPinned = (loc: InfoviewLocation) => pinnedLocs.some((l) => locationEq(l, loc));
    const pinKey = React.useRef<number>(0);
    const pin = () => {
        if (isPinned(curLoc)) {return; }
        pinKey.current += 1;
        const pins = [...pinnedLocs, { ...curLoc, key: pinKey.current }];
        setPinnedLocs(pins);
        void syncPins(pins);
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
        void syncPins(pins);
    }
    return <>
        <div>
            {pinnedLocs.map((loc) =>
                <Info key={loc.key} loc={loc} isPinned={true} isCursor={false} onPin={unpin(loc.key)}/>)}
        </div>
        <Info loc={curLoc} isPinned={false} isCursor={true} onPin={pin}/>
    </>;
}

function usePaused<T>(isPaused: boolean, t: T): T {
    const old = React.useRef<T>(t);
    if (!isPaused) old.current = t;
    return old.current;
}

function AllMessages({allMessages: allMessages0}: {allMessages: ProcessedMessage[]}): JSX.Element {
    const config = React.useContext(ConfigContext);
    const [isPaused, setPaused] = React.useState<boolean>(false);
    const allMessages = usePaused(isPaused, allMessages0);
    const setOpenRef = React.useRef<React.Dispatch<React.SetStateAction<boolean>>>();
    useEvent(toggleAllMessagesEvent, () => setOpenRef.current((t) => !t));
    return <Details setOpenRef={setOpenRef} initiallyOpen={!config.infoViewAutoOpenShowGoal}>
        <summary>
            All Messages ({allMessages.length})
            <span className="fr">
                <a className="link pointer mh2 dim"
                        onClick={e => { e.preventDefault(); setPaused(!isPaused)}}
                        title={isPaused ? 'continue updating' : 'pause updating'}>
                    {isPaused ? <ContinueIcon/> : <PauseIcon/>}
                </a>
            </span>
        </summary>
        <div className="ml1"> <Messages messages={allMessages}/> </div>
    </Details>;
}

const domContainer = document.querySelector('#react_root');
ReactDOM.render(<Main/>, domContainer);
