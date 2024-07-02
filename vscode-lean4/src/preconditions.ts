import { OutputChannel } from "vscode";
import { ExtUri } from "./utils/exturi";
import { PreconditionCheckResult } from "./diagnostics/setupNotifs";
import {
    checkAll,
    checkIsLakeInstalledCorrectly,
    checkIsLeanVersionUpToDate,
    checkIsValidProjectFolder,
} from './diagnostics/setupDiagnostics'
import { willUseLakeServer } from "./utils/projectInfo";

export async function checkLean4ProjectPreconditions(
    channel: OutputChannel,
    folderUri: ExtUri,
): Promise<PreconditionCheckResult> {
    return await checkAll(
        () => checkIsValidProjectFolder(channel, folderUri),
        () => checkIsLeanVersionUpToDate(channel, folderUri, { modal: false }),
        async () => {
            if (!(await willUseLakeServer(folderUri))) {
                return 'Fulfilled'
            }
            return await checkIsLakeInstalledCorrectly(channel, folderUri, {})
        },
    )
}