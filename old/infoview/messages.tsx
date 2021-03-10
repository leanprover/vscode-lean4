import { basename, escapeHtml, colorizeMessage } from './util';
import { Message } from 'lean-client-js-node';
import * as React from 'react';
import { Location, Config } from '../src/shared';
import { ClippyIcon, CopyToCommentIcon, GoToFileIcon } from './svg_icons';
import { copyText, copyToComment, reveal } from './server';
import { Widget } from './widget';
import * as trythis from '../src/trythis';

function compareMessages(m1: Message, m2: Message): boolean {
    return m1.file_name === m2.file_name &&
        m1.pos_line === m2.pos_line && m1.pos_col === m2.pos_col &&
        m1.severity === m2.severity && m1.caption === m2.caption && m1.text === m2.text &&
        !!m1.widget === !!m2.widget && (!m1.widget ||
            m1.widget.line === m2.widget.line && m1.widget.column === m2.widget.column && m1.widget.id === m2.widget.id);
}

interface MessageViewProps {
    m: Message;
}

const MessageView = React.memo(({m}: MessageViewProps) => {
    const b = escapeHtml(basename(m.file_name));
    const l = m.pos_line; const c = m.pos_col;
    const loc: Location = {file_name: m.file_name, column: c, line: l}
    const shouldColorize = m.severity === 'error';
    let text = escapeHtml(m.text)
    text = text.replace(trythis.regexGM, (_, tactic) => {
        const command = encodeURI('command:_lean.pasteTacticSuggestion?' +
            JSON.stringify([m, tactic]));
        return `${trythis.magicWord}<a class="link" href="${command}" title="${tactic}">${tactic}</a>`
    });
    text = shouldColorize ? colorizeMessage(text) : text;
    const title = `${b}:${l}:${c}`;
    return <details open>
        <summary className={m.severity + ' mv2 pointer'}>{title}
                <span className="fr">
                    <a className={'link pointer mh2 dim '} onClick={e => { e.preventDefault(); reveal(loc); }} title="reveal file location"><GoToFileIcon/></a>
                    { m.widget ? null : <a className="link pointer mh2 dim" title="copy message to comment" onClick={e => {e.preventDefault(); copyToComment(m.text)}}><CopyToCommentIcon/></a> }
                    { m.widget ? null : <a className="link pointer mh2 dim" title="copy message to clipboard" onClick={e => {e.preventDefault(); copyText(m.text)}}><ClippyIcon/></a> }
                </span>
        </summary>
        <div className="ml1">
            { m.widget ? <Widget fileName={m.file_name} widget={m.widget}/> :
            <pre className="font-code" style={{whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{ __html: text }} />
            }
        </div>
    </details>
}, (a,b) => compareMessages(a.m, b.m));

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
        .sort((a, b) => a.pos_line === b.pos_line ? a.pos_col - b.pos_col : a.pos_line - b.pos_line)
        .map((m) => {
            const key0 = `${m.pos_line}:${m.pos_col}`;
            keys[key0] = (keys[key0] || 0)+1;
            return { ...m, key: `${key0}:${keys[key0]}` };
        });
}

export function GetMessagesFor(allMessages: Message[], loc: Location, config: Config): Message[] {
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
