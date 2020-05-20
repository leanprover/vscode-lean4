import { WidgetComponent, Location, WidgetEventHandler, WidgetEventMessage, WidgetEventResponse } from '../src/typings';
import * as React from 'react';
import { global_server, post } from './server';
import { LocationContext } from '.';
import { Widget } from './widget';
import { Goal } from './goal';
import { MessagesFor } from './messages';
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

    function updateInfo() {
        if (props.loc === null) {
            setWidget(null);
            setGoalState(null);
            return;
        }
        global_server.info(loc.file_name, loc.line, loc.column)
            .then((info) => {
                const record: any = info.record;
                if (record && record.widget) {
                    setWidget(record.widget);
                }
                if (record && record.state) {
                    setGoalState(record.state);
                }
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
    const border_style = 'pl2 bl ' + (isCursor ? 'b--blue ' : 'b--yellow ');
    return <LocationContext.Provider value={loc}>
        <details className={border_style} open
          onMouseEnter={() => post({command:'hover_position', loc})}
          onMouseLeave={() => post({command:'stop_hover'})}>
            <summary className="mv2">
                {`${basename(loc.file_name)}:${loc.line}:${loc.column}`}
                <span className="fr">
                    {goalState && <a className="link pointer" onClick={() => copyToComment()}>copy to comment</a>}
                    <a className="link pointer" onClick={() => onPin(!isPinned)}>{isPinned ? 'unpin' : 'pin'}</a>
                </span>
            </summary>
            <div className="ml3">
                <Widget widget={widget} post={e => handleWidgetEvent(e)} />
                <Goal goalState={goalState} />
                <MessagesFor loc={loc}/>
            </div>
        </details>
    </LocationContext.Provider>;
}

