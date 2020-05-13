import { basename, escapeHtml, colorizeMessage, Collapsible } from './util';
import { Message } from 'lean-client-js-node';
import React = require('react');
import { Location, DisplayMode, Config } from '../src/typings';
import { MessagesContext, ConfigContext } from '.';

function compareMessages(m1: Message, m2: Message): boolean {
    return (m1.file_name === m2.file_name &&
        m1.pos_line === m2.pos_line && m1.pos_col === m2.pos_col &&
        m1.severity === m2.severity && m1.caption === m2.caption && m1.text === m2.text);
}

export function MessageView(m: Message) {
    // const f = escapeHtml(m.file_name);
    const b = escapeHtml(basename(m.file_name));
    const l = m.pos_line; const c = m.pos_col;
    // const el = m.end_pos_line || l;
    // const ec = m.end_pos_col || c;
    // const cmd = encodeURI('command:_lean.revealPosition?' +
        // JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
        // JSON.stringify([(m.file_name), m.pos_line, m.pos_col])); // [TODO] Uri.file isn't available in the webview?
    const shouldColorize = m.severity === 'error';
    let text = escapeHtml(m.text)
    text = shouldColorize ? colorizeMessage(text) : text;
    return <Collapsible title={`${b}:${l}:${c}`} headerClassName={m.severity}>
        <pre className="font-code" dangerouslySetInnerHTML={{ __html: text }} />
    </Collapsible>
    // return <div className={`message ${m.severity}`} data-line={l} data-column={c} data-end-line={el} data-end-column={ec}>
    //     <h1 title={`${f}:${l}:${c}`}>
    //         <a href={cmd}>
    //             {b}:{l}:{c}: {m.severity} {escapeHtml(m.caption)}
    //         </a>
    //     </h1>
    //     <pre className="font-code" dangerouslySetInnerHTML={{ __html: text }} />
    // </div>;
}

export function Messages(props: {messages: Message[]}): JSX.Element {
    if (!props.messages || props.messages.length === 0) { return null; }
    const msgs = (props.messages || []).map(m =>
      <MessageView {...m} key={m.file_name + m.pos_line + m.pos_col + m.caption}/>);
    return <Collapsible title="Messages">{msgs}</Collapsible>
}

interface MessagesForProps {
    loc: Location;
}

export function MessagesFor(props: MessagesForProps) {
    const allMessages = React.useContext(MessagesContext);
    const config = React.useContext(ConfigContext);
    const loc = props.loc;
    let msgs: Message[];
    switch (config.displayMode) {
        case DisplayMode.OnlyState:
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
            break;

        case DisplayMode.AllMessage:
            msgs = allMessages
                .filter((m) => m.file_name === l.file_name)
                .sort((a, b) => a.pos_line === b.pos_line
                    ? a.pos_col - b.pos_col
                    : a.pos_line - b.pos_line);
            break;
    }
    return <Messages messages={msgs}/>
    // if (!prevMsgs) {
    //     return msgs;
    // }
    // if (msgs.length === prevMsgs.length) {
    //     let eq = true;
    //     for (let i = 0; i < msgs.length; i++) {
    //         if (!compareMessages(msgs[i], prevMsgs[i])) {
    //             eq = false;
    //             break;
    //         }
    //     }
    //     if (eq) { return prevMsgs; }
    // }
}