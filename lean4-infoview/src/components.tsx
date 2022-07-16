import * as React from 'react';

import { InteractiveMessage } from './infoview/traceExplorer';
import { useAsync, mapRpcError } from './infoview/util';
import { RpcContext } from './infoview/rpcSessions';
import { InteractiveDiagnostics_msgToInteractive, MessageData } from '@lean4/infoview-api';

/** Display the given message data as interactive, pretty-printed text. */
export function InteractiveMessageData({ msg }: { msg: MessageData }) {
    const rs = React.useContext(RpcContext)

    const [status, tt, error] = useAsync(
        () => InteractiveDiagnostics_msgToInteractive(rs, msg, 0),
        [rs, msg]
    )

    if (tt) {
        return <InteractiveMessage fmt={tt} />
    } else if (status === 'pending') {
        return <>...</>
    } else {
        return <div>Failed to display message:
            {error && <span>{mapRpcError(error).message}</span>}
        </div>
    }
}
