import { Location } from '../src/shared';
import * as React from 'react';
import { global_server, post, CopyToCommentEvent, ServerRestartEvent } from './server';
import { LocationContext, MessagesContext, ConfigContext } from '.';
import { Widget } from './widget';
import { Goal } from './goal';
import { GetMessagesFor, Messages } from './messages';
import { basename } from './util';
import { CopyToCommentIcon, PinnedIcon, PinIcon, ContinueIcon, PauseIcon, RefreshIcon } from './svg_icons';
import { WidgetData, WidgetEventRequest, WidgetEventHandler, WidgetEventRecord } from 'lean-client-js-node';

interface InfoProps {
    loc?: Location;
    isPinned: boolean;
    isCursor: boolean;
    onEdit: (l: Location, text: string) => void;
    onPin: (new_pin_state: boolean) => void;
    paused: boolean;
    setPaused: (paused: boolean) => void;
}

type InfoStatus = 'updating' | 'error' | 'pinned' | 'cursor';

const statusColTable: {[T in InfoStatus]: string} = {
    'updating': 'orange',
    'cursor': 'blue',
    'pinned': 'purple',
    'error': 'red',
}

export function Info(props: InfoProps) {
    const {loc, isPinned, isCursor, onEdit, onPin, paused, setPaused} = props;
    const [widget, setWidget]           = React.useState<WidgetData | null>(null);
    const [goalState, setGoalState]     = React.useState<string | null>(null);
    const [updating, setUpdating]       = React.useState<boolean>(false);
    const [updateError, setUpdateError] = React.useState<any | null>(null);
    const allMessages = React.useContext(MessagesContext);
    const config      = React.useContext(ConfigContext);

    /** Called to get new info from the server. */
    async function updateInfo(force = false) {
        if (paused && !force) { return; }
        setUpdateError(null);
        setUpdating(true);
        if (!loc) {
            setWidget(null);
            setGoalState(null);
            return;
        }
        try {
            const info = await global_server.info(loc.file_name, loc.line, loc.column);
            const record = info.record;
            setGoalState(record && record.state);
            if (record && record.widget && record.widget.html === undefined) {
                const { widget: newWidget } = await global_server.send({
                    command: 'get_widget',
                    line: record.widget.line,
                    column: record.widget.column,
                    id: (record.widget as any).id,
                    file_name: props.loc.file_name,
                } as any) as any;
                setWidget(newWidget);
            } else {
                setWidget(record && record.widget);
            }
            setUpdating(false);
            return;
        } catch (e) {
            setUpdateError(e);
            setUpdating(false);
            return;
        }
    }

    React.useEffect(() => {updateInfo();}, [ // perform updateInfo if any of these change.
        loc,
        paused,
    ]);
    // update the infos if the server restarts.
    React.useEffect(() => {
        const h = ServerRestartEvent.on(() => updateInfo());
        return () => h.dispose();
    });

    async function handleWidgetEvent(e: {kind; handler: WidgetEventHandler; args}) {
        if (!props.loc) {
            updateInfo();
            return;
        }
        const message: WidgetEventRequest = {
            command: 'widget_event',
            line: widget.line,
            column: widget.column,
            id: (widget as any).id,
            file_name: props.loc.file_name,
            ...e,
        } as any;
        const result = await global_server.send(message);
        if (!result.record) { return; }
        const record = result.record;
        if (record.status === 'success' && record.widget) {
            setWidget(record.widget);
        } else if (record.status === 'edit') {
            setWidget(record.widget);
            onEdit(props.loc, record.action);
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for ${message.handler}: invalid handler.`)
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message || record}`);
        }
    }

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
    const status: InfoStatus = updating ? 'updating' : updateError ? 'error' : isPinned ? 'pinned' : 'cursor';
    const border_style = 'pl2 bl ' + (`b--${statusColTable[status]} `);
    const messages = GetMessagesFor(allMessages, loc, config);
    const nothingToShow = !widget && !goalState && messages.length === 0;
    const locationString = `${basename(loc.file_name)}:${loc.line}:${loc.column}`;
    return <LocationContext.Provider value={loc}>
        <details className={border_style} open
          onMouseEnter={() => post({command:'hover_position', loc})}
          onMouseLeave={() => post({command:'stop_hover'})}>
            <summary className="mv2">
                {locationString}
                <span className="fr">
                    {goalState && <a className="link pointer mh2 dim" title="copy to comment" onClick={e => {e.preventDefault(); copyToComment()}}><CopyToCommentIcon/></a>}
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); onPin(!isPinned)}} title={isPinned ? 'unpin' : 'pin'}>{isPinned ? <PinnedIcon/> : <PinIcon/>}</a>
                    <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); setPaused(!paused)}} title={paused ? 'continue' : 'pause'}>{paused ? <ContinueIcon/> : <PauseIcon/>}</a>
                    <a className={'link pointer mh2 dim ' + (updating ? 'spin' : '')} onClick={e => { e.preventDefault(); updateInfo(true); }} title="refresh"><RefreshIcon/></a>
                </span>
            </summary>
            <div className="ml1">
                {updateError && <div className="error">Error updating: {updateError.message || updateError}. <a className="link pointer dim" onClick={e => updateInfo(true)}>Try again.</a></div> }
                <details open className={widget ? '' : 'dn'}>
                    <summary className="mv2 pointer">Widget</summary>
                    <div className={'ml1 ' + (paused ? 'o-60' : '')} >
                        <Widget widget={widget} post={e => handleWidgetEvent(e)} />
                    </div>
                </details>
                <details open={!widget} className={goalState ? '' : 'dn'}>
                    <summary className="mv2 pointer">Tactic State</summary>
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
                {nothingToShow && (updating ? 'updating...' : `no info found at ${locationString}`)}
            </div>
        </details>
    </LocationContext.Provider>;
}

