import * as React from 'react';
import { copyToCommentEvent, copyToComment, pauseEvent, continueEvent, toggleUpdating, serverRestarted, allMessagesEvent, requestPlainGoal, reveal } from './server';
import { LocationContext, ConfigContext } from '.';
import { Goal } from './goal';
import { Messages, processMessages, ProcessedMessage, getMessagesFor } from './messages';
import { basename, useEvent } from './util';
import { CopyToCommentIcon, PinnedIcon, PinIcon, ContinueIcon, PauseIcon, RefreshIcon, GoToFileIcon } from './svg_icons';
import { Details } from './collapsing';
import { InfoviewLocation, Message, PlainGoal } from '../src/infoviewApi';
import { Event } from './event';

type InfoStatus = 'updating' | 'error' | 'pinned' | 'cursor' | 'loading';

const statusColTable: {[T in InfoStatus]: string} = {
    'updating': '',
    'loading': 'gold',
    'cursor': '',
    'pinned': '',
    'error': 'dark-red',
}

interface InfoProps {
    loc: InfoviewLocation;
    isPinned: boolean;
    isCursor: boolean;
    onPin: (newPinState: boolean) => void;
}

// function isLoading(ts: CurrentTasksResponse, l: InfoviewLocation): boolean {
//     return l &&
//         ts.tasks.some(t => t.uri === l.uri && t.pos_line < l.line && l.line < t.end_pos_line);
// }

// function isDone(ts: CurrentTasksResponse) {
//     return ts.tasks.length === 0;
// }

function useMappedEvent<T, S>(ev: Event<T>, initial: S, f: (_: T) => S, deps?: React.DependencyList): S {
    const [s, setS] = React.useState<S>(initial);
    useEvent(ev, (t) => setS(f(t)), deps);
    return s;
}

// returns function that triggers `cb`
// - but only ms milliseconds after the first call
// - and not more often than once every ms milliseconds
function delayedThrottled(ms: number, cb: () => void): () => void {
    const waiting = React.useRef<boolean>(false);
    const callbackRef = React.useRef<() => void>();
    callbackRef.current = cb;
    return () => {
        if (!waiting.current) {
            waiting.current = true;
            setTimeout(() => {
                waiting.current = false;
                callbackRef.current();
            }, ms);
        }
    };
}

interface InfoState {
    loc: InfoviewLocation;
    loading: boolean;
    goal?: PlainGoal;
    messages: ProcessedMessage[];
    error?: string;
    triggerUpdate: () => void;
}

function infoState(isPaused: boolean, loc: InfoviewLocation): InfoState {
    const loading = false; // TODO
    // useMappedEvent(global_server.tasks, false, (t) => isLoading(t, loc), [loc]);

    const [goal, setGoal] = React.useState<PlainGoal>();
    const [error, setError] = React.useState<string>();
    const triggerUpdate = delayedThrottled(loading ? 500 : 50, async () => {
        if (isPaused) return;
        if (!loc) {
            setGoal(null);
            setError(null);
            return;
        }
        try {
            const plainGoal = await requestPlainGoal(loc);
            setGoal(plainGoal);
            setError(null);
        } catch (err) {
            setError('' + err);
            setGoal(null);
        }
    });

    const tasksFinished = true;
    // useMappedEvent(global_server.tasks, true, (t) => isDone(t) ? new Object() : false);
    React.useEffect(() => triggerUpdate(), [loc, isPaused, tasksFinished]);
    useEvent(serverRestarted, triggerUpdate);
    // useEvent(global_server.error, triggerUpdate);

    const config = React.useContext(ConfigContext);
    const [messages, setMessages] = React.useState<ProcessedMessage[]>([]);
    const updateMsgs = (msgs: Message[]) => {
        setMessages(loc ? processMessages(getMessagesFor(msgs, loc, config)) : []);
    };
    React.useEffect(() => updateMsgs(allMessagesEvent.current), [loc, config]);
    useEvent(allMessagesEvent, updateMsgs, [loc, config]);

    return { loc, loading, goal, error, messages, triggerUpdate };
}

export function Info(props: InfoProps): JSX.Element {
    const {isCursor, isPinned, onPin} = props;

    const [isPaused, setPaused] = React.useState<boolean>(false);
    const isCurrentlyPaused = React.useRef<boolean>();
    isCurrentlyPaused.current = isPaused;

    const stateRef = React.useRef<InfoState>({loc: null, loading: true, messages: [], triggerUpdate: () => {}});
    const newState = infoState(isPaused, (isPaused && stateRef.current.loc) || props.loc);
    if (!isPaused) stateRef.current = newState;
    const {loc, goal, error, loading, messages} = stateRef.current;

    function copyGoalToComment() {
        if (goal?.rendered) void copyToComment(goal.rendered);
    }

    // If we are the cursor infoview, then we should subscribe to
    // some commands from the extension
    useEvent(copyToCommentEvent, () => isCursor && copyGoalToComment(), [isCursor, goal]);
    useEvent(pauseEvent, () => isCursor && setPaused(true), [isCursor]);
    useEvent(continueEvent, () => isCursor && setPaused(false), [isCursor]);
    useEvent(toggleUpdating, () => isCursor && setPaused(!isCurrentlyPaused.current), [isCursor]);

    const status: InfoStatus = loading ? 'loading' : error ? 'error' : isPinned ? 'pinned' : 'cursor';
    const statusColor = statusColTable[status];
    const nothingToShow = !goal && !messages.length;
    const locationString = loc && `${basename(loc.uri)}:${loc.line}:${loc.character}`;

    // TODO: updating of paused views
    const forceUpdate = () => !isCurrentlyPaused.current && stateRef.current.triggerUpdate();

    return <LocationContext.Provider value={loc}>
        <Details initiallyOpen>
            <summary style={{transition: 'color 0.5s ease'}} className={'mv2 ' + statusColor}>
                {locationString}
                {isPinned && !isPaused && ' (pinned)'}
                {!isPinned && isPaused && ' (paused)'}
                {isPinned && isPaused && ' (pinned and paused)'}
                <span className="fr">
                    {goal && <a className="link pointer mh2 dim" title="copy state to comment" onClick={e => {e.preventDefault(); copyGoalToComment()}}><CopyToCommentIcon/></a>}
                    {isPinned && <a className={'link pointer mh2 dim '} onClick={e => { e.preventDefault(); void reveal(loc); }} title="reveal file location"><GoToFileIcon/></a>}
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); onPin(!isPinned)}} title={isPinned ? 'unpin' : 'pin'}>{isPinned ? <PinnedIcon/> : <PinIcon/>}</a>
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); setPaused(!isPaused)}} title={isPaused ? 'continue updating' : 'pause updating'}>{isPaused ? <ContinueIcon/> : <PauseIcon/>}</a>
                    { !isPaused && <a className={'link pointer mh2 dim'} onClick={e => { e.preventDefault(); forceUpdate(); }} title="update"><RefreshIcon/></a> }
                </span>
            </summary>
            <div className="ml1">
                <div>
                    {!loading && error &&
                        <div className="error">
                            Error updating: {'' + error}.
                            <a className="link pointer dim" onClick={e => forceUpdate()}>Try again.</a>
                        </div> }
                </div>
                <div>
                    { goal &&
                        <Details initiallyOpen>
                            <summary>
                                Tactic state
                            </summary>
                            <div className='ml1'>
                                <Goal plainGoals={goal} />
                            </div>
                        </Details> }
                </div>
                <div>
                    { messages.length > 0 &&
                        <Details initiallyOpen>
                            <summary className="mv2 pointer">Messages ({messages.length})</summary>
                            <div className="ml1">
                                <Messages messages={messages}/>
                            </div>
                        </Details> }
                </div>
                {nothingToShow && (
                    loading ? 'Loading...' :
                    isPaused ? <span>Updating is paused. <a className="link pointer dim" onClick={e => forceUpdate()}>Refresh</a> or <a className="link pointer dim" onClick={e => setPaused(false)}>resume updating</a> to see information</span> :
                    'No info found.')}
            </div>
        </Details>
    </LocationContext.Provider>;
}

