import { WidgetComponent, Location, WidgetEventHandler, WidgetEventMessage, WidgetEventResponse } from '../src/typings';
import * as React from 'react';
import { global_server, post } from './server';
import { LocationContext, MessagesContext, ConfigContext } from '.';
import { Widget } from './widget';
import { Goal } from './goal';
import { GetMessagesFor, Messages } from './messages';
import { basename } from './util';

interface InfoProps {
    loc: Location | null;
    isPinned: boolean;
    isCursor: boolean;
    onEdit: (l: Location, text: string) => void;
    onPin: (new_pin_state: boolean) => void;
}

export function Info(props: InfoProps) {
    const {loc, isPinned, isCursor, onEdit, onPin} = props;
    const [widget, setWidget] = React.useState<{html: WidgetComponent | null} | null>(null);
    const [goalState, setGoalState] = React.useState<string | null>(null);
    const allMessages = React.useContext(MessagesContext);
    const config = React.useContext(ConfigContext);

    function updateInfo() {
        if (props.loc === null) {
            setWidget(null);
            setGoalState(null);
            return;
        }
        global_server.info(loc.file_name, loc.line, loc.column)
            .then((info) => {
                const record: any = info.record;
                setWidget(record && record.widget);
                setGoalState(record && record.state);
            });
    }

    React.useEffect(() => updateInfo(), [props.loc && props.loc.line, props.loc && props.loc.column, props.loc && props.loc.file_name]);

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

    function copyToComment() {
        if (!goalState) {return; }
        post({ command: 'insert_text', text: `/-\n${goalState}\n-/\n`})
    }

    if (loc === null) {
        return <div>Waiting for info... </div>
    }
    const border_style = 'pl2 bl pointer ' + (isCursor ? 'b--blue ' : 'b--yellow ');
    const messages = GetMessagesFor(allMessages, loc, config);
    const nothing_to_show = !widget && !goalState && messages.length === 0;
    return <LocationContext.Provider value={loc}>
        <details className={border_style} open
          onMouseEnter={() => post({command:'hover_position', loc})}
          onMouseLeave={() => post({command:'stop_hover'})}>
            <summary className="mv2">
                {`${basename(loc.file_name)}:${loc.line}:${loc.column}`}
                <span className="fr">
                    {goalState && <a className="link pointer mh3 dim" onClick={e => {e.preventDefault(); copyToComment()}}>copy to comment</a>}
                    <a className="link pointer mh3 dim" onClick={e => { e.preventDefault(); onPin(!isPinned)}}>{isPinned ? 'unpin' : 'pin'}</a>
                </span>
            </summary>
            <div className="ml3">
                <details open className={widget ? '' : 'dn'}>
                    <summary className="mv2 pointer">Widget</summary>
                    <div className="ml3">
                        <Widget widget={widget} post={e => handleWidgetEvent(e)} />
                    </div>
                </details>
                <details open className={goalState ? '' : 'dn'}>
                    <summary className="mv2 pointer">Tactic State</summary>
                    <div className="ml3">
                        <Goal goalState={goalState} />
                    </div>
                </details>
                <details open className={messages.length === 0 ? 'dn' : '0'}>
                    <summary className="mv2 pointer">Messages</summary>
                    <div className="ml3">
                        <Messages messages={messages}/>
                    </div>
                </details>
            </div>
        </details>
    </LocationContext.Provider>;
}

