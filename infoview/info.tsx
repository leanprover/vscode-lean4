import { Location } from '../src/shared';
import * as React from 'react';
import { post, CopyToCommentEvent, copyToComment, PauseEvent, ContinueEvent, ToggleUpdatingEvent } from './server';
import { LocationContext, ConfigContext } from '.';
import { Widget } from './widget';
import { Goal } from './goal';
import { Messages, processMessages } from './messages';
import { basename } from './util';
import { CopyToCommentIcon, PinnedIcon, PinIcon, ContinueIcon, PauseIcon, RefreshIcon, GoToFileIcon } from './svg_icons';
import { useInfo } from './event_model';
import { Details } from './collapsing';

type InfoStatus = 'updating' | 'error' | 'pinned' | 'cursor' | 'loading';

const statusColTable: {[T in InfoStatus]: string} = {
    'updating': '',
    'loading': 'gold',
    'cursor': '',
    'pinned': '',
    'error': 'dark-red',
}

interface InfoProps {
    loc: Location;
    isPinned: boolean;
    isCursor: boolean;
    onPin: (new_pin_state: boolean) => void;
}

export function Info(props: InfoProps) {
    const {isCursor, isPinned, onPin} = props;

    const [isPaused0, setPaused] = React.useState<boolean>(false);
    const isCurrentlyPaused = React.useRef<boolean>()
    const {loc, isLoading:loading, isUpdating:updating, error:updateError, goalState, widget, messages: messages0, isPaused, forceUpdate} =
        useInfo({loc: props.loc, isPaused: isPaused0});
    isCurrentlyPaused.current = isPaused;

    const messages = processMessages(messages0);

    function copyGoalToComment() {
        if (goalState) copyToComment(goalState);
    }

    // If we are the cursor infoview, then we should subscribe to
    // some commands from the extension
    React.useEffect(() => {
        if (isCursor) {
            const h = CopyToCommentEvent.on(copyGoalToComment);
            return () => h.dispose();
        }
    }, [isCursor]);

    React.useEffect(() => {
        if (isCursor) {
            const subscriptions = [
                PauseEvent.on(l => setPaused(true)),
                ContinueEvent.on(l => setPaused(false)),
                ToggleUpdatingEvent.on(l => setPaused(!isCurrentlyPaused.current)),
            ];

            return () => { for (const s of subscriptions) s.dispose(); }
        }
    }, [isCursor]);

    const [displayMode, setDisplayMode] = React.useState<'widget' | 'text'>('widget');
    const widgetModeSwitcher =
        <select value={displayMode} onChange={(ev) => setDisplayMode(ev.target.value as any)}>
            <option value={'widget'}>widget</option>
            <option value={'text'}>plain text</option>
        </select>;

    if (!loc) {
        return <div>Waiting for info... </div>
    }
    const status: InfoStatus = loading ? 'loading' : updating ? 'updating' : updateError ? 'error' : isPinned ? 'pinned' : 'cursor';
    const statusColor = statusColTable[status];
    const nothingToShow = !widget && !goalState && messages.length === 0;
    const locationString = `${basename(loc.file_name)}:${(loc).line}:${(loc).column}`;

    return <LocationContext.Provider value={loc}>
        <Details open>
            <summary style={{transition: 'color 0.5s ease'}} className={'mv2 ' + statusColor}>
                {locationString}
                {isPinned && !isPaused && ' (pinned)'}
                {!isPinned && isPaused && ' (paused)'}
                {isPinned && isPaused && ' (pinned and paused)'}
                <span className="fr">
                    {goalState && <a className="link pointer mh2 dim" title="copy state to comment" onClick={e => {e.preventDefault(); copyGoalToComment()}}><CopyToCommentIcon/></a>}
                    {isPinned && <a className={'link pointer mh2 dim '} onClick={e => { e.preventDefault(); post({command: 'reveal', loc}); }} title="reveal file location"><GoToFileIcon/></a>}
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); onPin(!isPinned)}} title={isPinned ? 'unpin' : 'pin'}>{isPinned ? <PinnedIcon/> : <PinIcon/>}</a>
                    { !isCursor && <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); setPaused(!isPaused)}} title={isPaused ? 'continue updating' : 'pause updating'}>{isPaused ? <ContinueIcon/> : <PauseIcon/>}</a> }
                    <a className={'link pointer mh2 dim ' + (updating ? 'spin' : '')} onClick={e => { e.preventDefault(); forceUpdate(); }} title="update"><RefreshIcon/></a>
                </span>
            </summary>
            <div className="ml1">
                <div>
                    {!loading && !updating && updateError &&
                        <div className="error">
                            Error updating: {updateError.message}.
                            <a className="link pointer dim" onClick={e => forceUpdate()}>Try again.</a>
                        </div> }
                </div>
                <div>
                    { (widget || goalState) &&
                        <Details open>
                            <summary>
                                Tactic state
                                { widget && <span className='fr'>{widgetModeSwitcher}</span> }
                            </summary>
                            <div className='ml1'>
                                { widget && displayMode === 'widget' ?
                                    <Widget widget={widget} fileName={loc.file_name} /> :
                                    <Goal goalState={goalState} /> }
                            </div>
                        </Details> }
                </div>
                <div>
                    { messages.length > 0 &&
                        <Details open>
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

