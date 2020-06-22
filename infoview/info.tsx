import { Location } from '../src/shared';
import * as React from 'react';
import { post, CopyToCommentEvent } from './server';
import { LocationContext, ConfigContext } from '.';
import { Widget } from './widget';
import { Goal } from './goal';
import { Messages } from './messages';
import { basename } from './util';
import { CopyToCommentIcon, PinnedIcon, PinIcon, ContinueIcon, PauseIcon, RefreshIcon, GoToFileIcon } from './svg_icons';
import { useInfo } from './event_model';

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
    onEdit: (l: Location, text: string) => void;
    onPin: (new_pin_state: boolean) => void;
    isPaused: boolean;
    setPaused: (paused: boolean) => void;
}

export function Info(props: InfoProps) {
    const {setPaused, onPin, onEdit, isCursor, isPinned} = props;
    const {loc, isLoading:loading, isUpdating:updating, isPaused: paused, error:updateError, goalState, widget, messages, forceUpdate} = useInfo(props);
    const config    = React.useContext(ConfigContext);

    function copyToComment(text?: string) {
        if (!(text || goalState)) { return; }
        post({ command: 'insert_text', text: `/-\n${text || goalState}\n-/\n`})
    }

    // If we are the cursor infoview, then we should subscribe to
    // some commands from the extension
    React.useEffect(() => {
        if (isCursor) {
            const h = CopyToCommentEvent.on(copyToComment);
            return () => h.dispose();
        }
    }, [isCursor]);

    if (!loc) {
        return <div>Waiting for info... </div>
    }
    const status: InfoStatus = loading ? 'loading' : updating ? 'updating' : updateError ? 'error' : isPinned ? 'pinned' : 'cursor';
    const statusColor = statusColTable[status];
    const nothingToShow = !widget && !goalState && messages.length === 0;
    const locationString = `${basename(loc.file_name)}:${(loc).line}:${(loc).column}`;
    return <LocationContext.Provider value={loc}>
        <details className="" open>
            <summary style={{transition: 'color 0.5s ease'}} className={'mv2 ' + statusColor}>
                {locationString}
                <span className="fr">
                    {goalState && <a className="link pointer mh2 dim" title="copy state to comment" onClick={e => {e.preventDefault(); copyToComment()}}><CopyToCommentIcon/></a>}
                    {isPinned && <a className={'link pointer mh2 dim '} onClick={e => { e.preventDefault(); post({command: 'reveal', loc}); }} title="reveal file location"><GoToFileIcon/></a>}
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); onPin(!isPinned)}} title={isPinned ? 'unpin' : 'pin'}>{isPinned ? <PinnedIcon/> : <PinIcon/>}</a>
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); setPaused(!paused)}} title={paused ? 'continue updating' : 'pause updating'}>{paused ? <ContinueIcon/> : <PauseIcon/>}</a>
                    <a className={'link pointer mh2 dim ' + (updating ? 'spin' : '')} onClick={e => { e.preventDefault(); forceUpdate(); }} title="update"><RefreshIcon/></a>
                </span>
            </summary>
            <div className="ml1">
                {!loading && !updating && updateError && <div className="error">Error updating: {updateError.message}. <a className="link pointer dim" onClick={e => forceUpdate()}>Try again.</a></div> }
                <div>
                    <Widget widget={widget} fileName={loc.file_name} onEdit={onEdit} />
                </div>
                <details open={!widget} className={goalState ? '' : 'dn'}>
                    <summary className="mv2 pointer">{widget ? 'Plaintext Tactic State' : 'Tactic State'}</summary>
                    <div className="ml1">
                        <Goal goalState={goalState} />
                    </div>
                </details>
                <details open className={messages.length === 0 ? 'dn' : '0'}>
                    <summary className="mv2 pointer">Messages ({messages.length})</summary>
                    <div className="ml1">
                        <Messages messages={messages} onCopyToComment={copyToComment}/>
                    </div>
                </details>
                {nothingToShow && (
                    loading ? 'Loading...' :
                    paused ? <span>Updating is paused. <a className="link pointer dim" onClick={e => forceUpdate()}>Refresh</a> or <a className="link pointer dim" onClick={e => setPaused(false)}>resume updating</a> to see information</span> :
                    `No info found at ${locationString}`)}
            </div>
        </details>
    </LocationContext.Provider>;
}

