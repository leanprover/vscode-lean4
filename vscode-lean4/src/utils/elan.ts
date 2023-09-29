import { ExecutionResult, batchExecute } from './batch';

export async function elanSelfUpdate(): Promise<ExecutionResult> {
    return await batchExecute('elan', ['self', 'update'])
}
