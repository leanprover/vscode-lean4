import * as React from 'react';

import { InteractiveCode } from './infoview/interactiveCode';
import { InteractiveDiagnostics_msgToInteractive, TaggedText, MsgEmbed, CodeWithInfos, MessageData, mapRpcError } from './infoview/rpcInterface';
import { InteractiveMessage } from './infoview/traceExplorer';
import { DocumentPosition, useAsync } from './infoview/util';
import { RpcContext } from './infoview/contexts';

export { DocumentPosition };
export { EditorContext, RpcContext, VersionContext } from './infoview/contexts';
export { EditorConnection } from './infoview/editorConnection';
export { RpcSessions } from './infoview/rpcSessions';
export { ServerVersion } from './infoview/serverVersion';

/** Display the given message data as interactive, pretty-printed text. */
export function InteractiveMessageData({ pos, msg }: { pos: DocumentPosition, msg: MessageData }) {
    const rs = React.useContext(RpcContext)

    const [status, tt, error] = useAsync(
        () => InteractiveDiagnostics_msgToInteractive(rs, pos, { msg, indent: 0 }),
        [pos.character, pos.line, pos.uri, msg]
    )

    if (tt) {
        return <InteractiveMessage pos={pos} fmt={tt} />
    } else if (status === 'pending') {
        return <>...</>
    } else {
        return <div>failed to load messages
            {error && <span>{mapRpcError(error).message}</span>}
        </div>
    }
}
