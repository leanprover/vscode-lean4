import { basename, escapeHtml, colorizeMessage } from './util';
import * as React from 'react';
import { ClippyIcon, CopyToCommentIcon, GoToFileIcon } from './svg_icons';
import { copyText, copyToComment, reveal } from './server';
import { Config, InfoviewLocation, Message } from '../src/infoviewApi';
import isEqual from 'react-fast-compare';

interface MessageViewProps {
    m: Message;
}

const MessageView = React.memo(({m}: MessageViewProps) => {
    const b = escapeHtml(basename(m.uri));
    const l = m.line;
    const c = m.character;
    const loc: InfoviewLocation = {uri: m.uri, character: c, line: l}
    const shouldColorize = m.severity === 0;
    let text = escapeHtml(m.message)
    text = shouldColorize ? colorizeMessage(text) : text;
    const title = `${b}:${l}:${c}`;
    return <details open>
        <summary className={m.severity + ' mv2 pointer'}>{title}
            <span className="fr">
                <a className="link pointer mh2 dim" onClick={e => { e.preventDefault(); void reveal(loc); }} title="reveal file location"><GoToFileIcon/></a>
                <a className="link pointer mh2 dim" title="copy message to comment" onClick={e => {e.preventDefault(); void copyToComment(m.message)}}><CopyToCommentIcon/></a>
                <a className="link pointer mh2 dim" title="copy message to clipboard" onClick={e => {e.preventDefault(); void copyText(m.message)}}><ClippyIcon/></a>
            </span>
        </summary>
        <div className="ml1">
            <pre className="font-code" style={{whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{ __html: text }} />
        </div>
    </details>
}, isEqual);

interface MessagesProps {
    messages: ProcessedMessage[];
}

export function Messages(props: MessagesProps): JSX.Element {
    const should_hide = !props.messages || props.messages.length === 0;
    if (should_hide) {return <>No messages.</>}
    const msgs = props.messages.map((m) =>
      <MessageView m={m} key={m.key} />);
    return <>{msgs}</>;
}

export interface ProcessedMessage extends Message {
    key: string;
}

/** Some processing for preparing all messages for viewing. */
export function processMessages(messages: Message[]): ProcessedMessage[] {
    const keys: { [key: string]: number } = {};
    return messages
        .sort((a, b) => a.line === b.line ? a.character - b.character : a.line - b.line)
        .map((m) => {
            const key0 = `${m.line}:${m.character}`;
            keys[key0] = (keys[key0] || 0)+1;
            return { ...m, key: `${key0}:${keys[key0]}` };
        });
}

export function getMessagesFor(allMessages: Message[], loc: InfoviewLocation, config: Config): Message[] {
    let msgs: Message[];
    /* Heuristic: find first position to the left which has messages attached,
        from that on show all messages in this line */
    msgs = allMessages
        .filter((m) => m.uri === loc.uri && m.line === loc.line)
        .sort((a, b) => a.character - b.character);
    if (!config.infoViewAllErrorsOnLine) {
        let startColumn: number;
        let startPos: number = null;
        for (let i = 0; i < msgs.length; i++) {
            if (loc.character < msgs[i].character) { break; }
            if (loc.character === msgs[i].character) {
                startColumn = loc.character;
                startPos = i;
                break;
            }
            if (startColumn == null || startColumn < msgs[i].character) {
                startColumn = msgs[i].character;
                startPos = i;
            }
        }
        if (startPos) {
            msgs = msgs.slice(startPos);
        }
    }
    return msgs;
}
