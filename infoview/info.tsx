import * as React from 'react';
import { copyToCommentEvent, copyToComment, pauseEvent, continueEvent, toggleUpdating, serverRestarted, allMessagesEvent, requestPlainGoal, reveal, progressEvent } from './server';
import { LocationContext, ConfigContext } from '.';
import { getGoals, Goal } from './goal';
import { Messages, processMessages, ProcessedMessage, getMessagesFor } from './messages';
import { basename, useEvent } from './util';
import { CopyToCommentIcon, PinnedIcon, PinIcon, ContinueIcon, PauseIcon, RefreshIcon, GoToFileIcon } from './svg_icons';
import { Details } from './collapsing';
import { InfoviewLocation, Message } from '../src/infoviewApi';
import { Event } from './event';
import { PlainGoal, ServerProgress } from '../src/leanclientTypes';

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

function isLoading(ts: ServerProgress, l: InfoviewLocation): boolean {
    return l && ts[l.uri] !== undefined && ts[l.uri] <= l.line
}

function isDone(ts: ServerProgress, l: InfoviewLocation) {
    return l && ts[l.uri] === undefined
}

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
    const serverProcessing = useMappedEvent(progressEvent, false, (t) => isLoading(t, loc), [loc]);

    const [goal, setGoal] = React.useState<PlainGoal>();
    const [error, setError] = React.useState<string>();
    const [fetchingInfo, setFetchingInfo] = React.useState<boolean>();
    const triggerUpdate = delayedThrottled(serverProcessing ? 500 : 50, async () => {
        if (isPaused) return;
        if (!loc) {
            setGoal(null);
            setError(null);
            setFetchingInfo(false);
            return;
        }
        try {
            const plainGoal = await requestPlainGoal(loc);
            setGoal(plainGoal);
            setError(null);
            setFetchingInfo(false);
        } catch (err) {
            if (err?.code === -32801) {
                // Document has been changed since we made the request, try again
                setError(null);
                setFetchingInfo(true);
                triggerUpdate();
            } else {
                setError(typeof err === 'string' ? err : JSON.stringify(err));
                setGoal(null);
                setFetchingInfo(false);
            }
        }
    });

    const tasksFinished = useMappedEvent(progressEvent, true,
        (t) => isDone(t, loc) ? new Object() : false, [loc]);
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

    return { loc, loading: serverProcessing || fetchingInfo, goal, error, messages, triggerUpdate };
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
        if (goal) {
            void copyToComment(getGoals(goal).join('\n\n'));
        }
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
    const locationString = loc && `${basename(loc.uri)}:${loc.line+1}:${loc.character}`;

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
                            Error updating: {error}.
                            <a className="link pointer dim" onClick={e => forceUpdate()}>Try again.</a>
                        </div> }
                </div>
                <div style={{display: goal ? 'block' : 'none'}}>
                        <Details initiallyOpen>
                            <summary>
                                Tactic state
                            </summary>
                            <div className='ml1'>
                                <Goal plainGoals={goal} />
                            </div>
                        </Details>
                </div>
                <div style={{display: messages.length > 0 ? 'block' : 'none'}}>
                        <Details initiallyOpen>
                            <summary className="mv2 pointer">Messages ({messages.length})</summary>
                            <div className="ml1">
                                <Messages messages={messages}/>
                            </div>
                        </Details>
                </div>
                {nothingToShow && (
                    loading ? 'Loading...' :
                    isPaused ? <span>Updating is paused. <a className="link pointer dim" onClick={e => forceUpdate()}>Refresh</a> or <a className="link pointer dim" onClick={e => setPaused(false)}>resume updating</a> to see information</span> :
                    'No info found.')}
            </div>
        </Details>
    </LocationContext.Provider>;
}

