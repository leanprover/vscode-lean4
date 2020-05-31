import { basename, escapeHtml, colorizeMessage } from './util';
import { Message } from 'lean-client-js-node';
import * as React from 'react';
import { Location, Config } from '../src/typings';
import { MessagesContext } from '.';

function compareMessages(m1: Message, m2: Message): boolean {
    return (m1.file_name === m2.file_name &&
        m1.pos_line === m2.pos_line && m1.pos_col === m2.pos_col &&
        m1.severity === m2.severity && m1.caption === m2.caption && m1.text === m2.text);
}

export function MessageView(m: Message) {
    const b = escapeHtml(basename(m.file_name));
    const l = m.pos_line; const c = m.pos_col;
    const shouldColorize = m.severity === 'error';
    let text = escapeHtml(m.text)
    text = shouldColorize ? colorizeMessage(text) : text;
    const title = `${b}:${l}:${c}`;
    return <details open>
        <summary className={m.severity + ' mv2 pointer'}>{title}</summary>
        <div className="ml1">
            <pre className="font-code" style={{whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{ __html: text }} />
        </div>
    </details>
}

export function Messages(props: {messages: Message[]}): JSX.Element {
    const should_hide = !props.messages || props.messages.length === 0;
    if (should_hide) {return <>No messages.</>}
    const msgs = (props.messages || []).map(m =>
      <MessageView {...m} key={m.file_name + m.pos_line + m.pos_col + m.caption}/>);
    return <>{msgs}</>;
}

export function AllMessages(props: {file_name?: string}) {
    const allMessages = React.useContext(MessagesContext);
    const msgs = processMessages(allMessages, props.file_name)
    return <Messages messages={msgs}/>
}

/** Some processing for preparing all messages for viewing. */
export function processMessages(messages: Message[], file_name) {
    return messages
        .filter((m) => file_name ? m.file_name === file_name : true)
        .sort((a, b) => a.pos_line === b.pos_line
            ? a.pos_col - b.pos_col
            : a.pos_line - b.pos_line);
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
