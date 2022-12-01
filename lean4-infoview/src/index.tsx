import * as React from 'react';
import { InteractiveDiagnostics_msgToInteractive, MessageData } from '@leanprover/infoview-api';
import { RpcContext } from './infoview/rpcSessions';
import { mapRpcError, useAsync } from './infoview/util';
import { InteractiveMessage } from './infoview/traceExplorer';

export * from '@leanprover/infoview-api';
export { useAsync, useAsyncWithTrigger, useEvent, useEventResult, useServerNotificationEffect,
useServerNotificationState, useClientNotificationEffect, useClientNotificationState } from './infoview/util';
export { EditorContext, VersionContext } from './infoview/contexts';
export { EditorConnection } from './infoview/editorConnection';
export { RpcContext } from './infoview/rpcSessions';
export { ServerVersion } from './infoview/serverVersion';
export { UserWidgetProps } from './infoview/userWidget';

export { InteractiveCode, InteractiveCodeProps } from './infoview/interactiveCode';
export { renderInfoview } from './infoview/main';

export { MessageData };

/** Display the given message data as interactive, pretty-printed text. */
export function InteractiveMessageData({ msg }: { msg: MessageData }) {
    const rs = React.useContext(RpcContext)

    const interactive = useAsync(
        () => InteractiveDiagnostics_msgToInteractive(rs, msg, 0),
        [rs, msg]
    )

    if (interactive.state === 'resolved') {
        return <InteractiveMessage fmt={interactive.value} />
    } else if (interactive.state === 'loading') {
        return <>...</>
    } else {
        return <div>Failed to display message:
            {<span>{mapRpcError(interactive.error).message}</span>}
        </div>
    }
}
