import { OutputChannel } from 'vscode'
import { batchExecuteWithProgress, ExecutionResult } from './batch'

export async function elanSelfUpdate(channel: OutputChannel): Promise<ExecutionResult> {
    return await batchExecuteWithProgress('elan', ['self', 'update'], 'Updating Elan', { channel })
}
