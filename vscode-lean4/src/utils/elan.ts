import { OutputChannel } from 'vscode';
import { ExecutionResult, batchExecuteWithProgress } from './batch';

export async function elanSelfUpdate(channel: OutputChannel): Promise<ExecutionResult> {
    return await batchExecuteWithProgress('elan', ['self', 'update'], 'Updating Elan', { channel })
}
