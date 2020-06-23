import { basename, escapeHtml, colorizeMessage } from './util';
import { Message, WidgetIdentifier } from 'lean-client-js-node';
import * as React from 'react';
import { Location, Config } from '../src/shared';
import { CopyToCommentIcon, GoToFileIcon } from './svg_icons';
import { post } from './server';
import { Widget } from './widget';

function compareMessages(m1: Message, m2: Message): boolean {
    return (m1.file_name === m2.file_name &&
        m1.pos_line === m2.pos_line && m1.pos_col === m2.pos_col &&
        m1.severity === m2.severity && m1.caption === m2.caption && m1.text === m2.text);
}

interface MessageViewProps {
    m: Message;
    onCopyToComment?: (x: string) => void;
}

export function MessageView(props: MessageViewProps) {
    const {m, onCopyToComment} = props;
    const b = escapeHtml(basename(m.file_name));
    const l = m.pos_line; const c = m.pos_col;
    const loc: Location = {file_name: m.file_name, column: c, line: l}
    const shouldColorize = m.severity === 'error';
    let text = escapeHtml(m.text)
    text = shouldColorize ? colorizeMessage(text) : text;
    const title = `${b}:${l}:${c}`;
    const widgetId: WidgetIdentifier | null = (m as any).widget;
    return <details open>
        <summary className={m.severity + ' mv2 pointer'}>{title}
                <span className="fr">
                    <a className={'link pointer mh2 dim '} onClick={e => { e.preventDefault(); post({command: 'reveal', loc}); }} title="reveal file location"><GoToFileIcon/></a>
                    {onCopyToComment && <a className="link pointer mh2 dim" title="copy message to comment" onClick={e => {e.preventDefault(); onCopyToComment(m.text)}}><CopyToCommentIcon/></a>}
                </span>
        </summary>
        <div className="ml1">
            { widgetId ? <Widget fileName={m.file_name} widget={widgetId}/> :
            <pre className="font-code" style={{whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{ __html: text }} />
            }
        </div>
    </details>
}

interface MessagesProps {
    messages: (Message & {key?})[];
    onCopyToComment?: (text: string) => void;
}

export function Messages(props: MessagesProps): JSX.Element {
    const should_hide = !props.messages || props.messages.length === 0;
    if (should_hide) {return <>No messages.</>}
    const msgs = (props.messages || []).map((m,i) =>
      <MessageView m={m} key={m.key || i} onCopyToComment={props.onCopyToComment}/>);
    return <>{msgs}</>;
}

/** Some processing for preparing all messages for viewing. */
export function processMessages(messages: Message[], file_name): (Message & {key: string})[] {
    const newmsgs = []
    for (const m of messages) {
        if (file_name && m.file_name !== file_name) {continue;}
        let key = `${m.file_name}:${m.pos_line}:${m.pos_col}--${m.text.substr(0, 10)}`;
        while (newmsgs.some(x => x.key === key)) {
            key += "'";
        }
        newmsgs.push({...m, key});
    }
    return newmsgs.sort((a, b) => a.pos_line === b.pos_line
            ? a.pos_col - b.pos_col
            : a.pos_line - b.pos_line)
}

export function GetMessagesFor(allMessages: Message[], loc: Location, config: Config) {
    let msgs: Message[];
    /* Heuristic: find first position to the left which has messages attached,
        from that on show all messages in this line */
    msgs = allMessages
        .filter((m) => m.file_name === loc.file_name &&
            m.pos_line === loc.line)
        .sort((a, b) => a.pos_col - b.pos_col);
    if (!config.infoViewAllErrorsOnLine) {
        let startColumn;
        let startPos = null;
        for (let i = 0; i < msgs.length; i++) {
            if (loc.column < msgs[i].pos_col) { break; }
            if (loc.column === msgs[i].pos_col) {
                startColumn = loc.column;
                startPos = i;
                break;
            }
            if (startColumn == null || startColumn < msgs[i].pos_col) {
                startColumn = msgs[i].pos_col;
                startPos = i;
            }
        }
        if (startPos) {
            msgs = msgs.slice(startPos);
        }
    }
    return msgs;
}
