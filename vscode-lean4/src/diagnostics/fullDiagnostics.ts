import { SemVer } from 'semver'
import { Disposable, OutputChannel, TextDocument, commands, env, window, workspace } from 'vscode'
import { ExecutionExitCode, ExecutionResult } from '../utils/batch'
import { ExtUri, FileUri, extUriEquals, toExtUri } from '../utils/exturi'
import { displayError, displayInformationWithInput } from '../utils/notifs'
import { findLeanProjectRoot } from '../utils/projectInfo'
import {
    ElanVersionDiagnosis,
    LeanVersionDiagnosis,
    ProjectSetupDiagnosis,
    SetupDiagnoser,
    SystemQueryResult,
    VSCodeVersionDiagnosis,
} from './setupDiagnoser'

export type FullDiagnostics = {
    systemInfo: SystemQueryResult
    vscodeVersionDiagnosis: VSCodeVersionDiagnosis
    extensionVersion: SemVer
    isCurlAvailable: boolean
    isGitAvailable: boolean
    elanVersionDiagnosis: ElanVersionDiagnosis
    leanVersionDiagnosis: LeanVersionDiagnosis
    projectSetupDiagnosis: ProjectSetupDiagnosis
    elanShowOutput: ExecutionResult
}

function formatCommandOutput(cmdOutput: string): string {
    return '\n```\n' + cmdOutput + '\n```'
}

function formatVSCodeVersionDiagnosis(d: VSCodeVersionDiagnosis): string {
    switch (d.kind) {
        case 'UpToDate':
            return `Reasonably up-to-date (version: ${d.version.toString()})`
        case 'Outdated':
            return `Outdated (version: ${d.currentVersion.toString()}, recommendedVersion: ${d.recommendedVersion.toString()})`
    }
}

function formatElanVersionDiagnosis(d: ElanVersionDiagnosis): string {
    switch (d.kind) {
        case 'UpToDate':
            return `Reasonably up-to-date (version: ${d.version.toString()})`
        case 'Outdated':
            return `Outdated (version: ${d.currentVersion.toString()}, recommended version: ${d.recommendedVersion.toString()})`
        case 'ExecutionError':
            return 'Execution error: ' + formatCommandOutput(d.message)
        case 'NotInstalled':
            return 'Not installed'
    }
}

function formatLeanVersionDiagnosis(d: LeanVersionDiagnosis): string {
    switch (d.kind) {
        case 'UpToDate':
            return `Reasonably up-to-date (version: ${d.version})`
        case 'IsLean3Version':
            return `Lean 3 version (version: ${d.version})`
        case 'IsAncientLean4Version':
            return `Pre-stable-release Lean 4 version (version: ${d.version})`
        case 'ExecutionError':
            return 'Execution error: ' + formatCommandOutput(d.message)
        case 'NotInstalled':
            return 'Not installed'
    }
}

function formatProjectSetupDiagnosis(d: ProjectSetupDiagnosis): string {
    switch (d.kind) {
        case 'SingleFile':
            return 'No open project'
        case 'MissingLeanToolchain':
            const parentProjectFolder =
                d.parentProjectFolder === undefined
                    ? ''
                    : `(Valid Lean project in parent folder: ${d.parentProjectFolder.fsPath})`
            return `Folder without lean-toolchain file (no valid Lean project) (path: ${d.folder.fsPath}) ${parentProjectFolder}`
        case 'ValidProjectSetup':
            return `Valid Lean project (path: ${d.projectFolder.fsPath})`
    }
}

function formatElanShowOutput(r: ExecutionResult): string {
    if (r.exitCode === ExecutionExitCode.CannotLaunch) {
        return 'Elan not installed'
    }
    if (r.exitCode === ExecutionExitCode.ExecutionError) {
        return 'Execution error: ' + formatCommandOutput(r.combined)
    }
    return formatCommandOutput(r.stdout)
}

export function formatFullDiagnostics(d: FullDiagnostics): string {
    return [
        `**Operating system**: ${d.systemInfo.operatingSystem}`,
        `**CPU architecture**: ${d.systemInfo.cpuArchitecture}`,
        `**CPU model**: ${d.systemInfo.cpuModels}`,
        `**Available RAM**: ${d.systemInfo.totalMemory}`,
        '',
        `**VS Code version**: ${formatVSCodeVersionDiagnosis(d.vscodeVersionDiagnosis)}`,
        `**Lean 4 extension version**: ${d.extensionVersion}`,
        `**Curl installed**: ${d.isCurlAvailable}`,
        `**Git installed**: ${d.isGitAvailable}`,
        `**Elan**: ${formatElanVersionDiagnosis(d.elanVersionDiagnosis)}`,
        `**Lean**: ${formatLeanVersionDiagnosis(d.leanVersionDiagnosis)}`,
        `**Project**: ${formatProjectSetupDiagnosis(d.projectSetupDiagnosis)}`,
        '',
        '-------------------------------------',
        '',
        `**Elan toolchains**: ${formatElanShowOutput(d.elanShowOutput)}`,
    ].join('\n')
}

export async function performFullDiagnosis(
    channel: OutputChannel,
    cwdUri: FileUri | undefined,
): Promise<FullDiagnostics> {
    const diagnose = new SetupDiagnoser(channel, cwdUri)
    return {
        systemInfo: diagnose.querySystemInformation(),
        vscodeVersionDiagnosis: diagnose.queryVSCodeVersion(),
        extensionVersion: diagnose.queryExtensionVersion(),
        isCurlAvailable: await diagnose.checkCurlAvailable(),
        isGitAvailable: await diagnose.checkGitAvailable(),
        elanVersionDiagnosis: await diagnose.elanVersion(),
        leanVersionDiagnosis: await diagnose.leanVersion(),
        projectSetupDiagnosis: await diagnose.projectSetup(),
        elanShowOutput: await diagnose.queryElanShow(),
    }
}

export class FullDiagnosticsProvider implements Disposable {
    private subscriptions: Disposable[] = []
    private outputChannel: OutputChannel
    // Under normal circumstances, we would use the last active `LeanClient` from `LeanClientProvider.getActiveClient()`
    // to determine the document that the user is currently working on.
    // However, when providing setup diagnostics, there might not be an active client due to errors in the user's setup,
    // in which case we still want to provide adequate diagnostics. Hence, we track the last active lean document
    // separately, regardless of whether there is an actual `LeanClient` managing it.
    private lastActiveLeanDocumentUri: ExtUri | undefined

    constructor(outputChannel: OutputChannel) {
        this.outputChannel = outputChannel

        if (window.activeTextEditor !== undefined) {
            this.lastActiveLeanDocumentUri = FullDiagnosticsProvider.getLean4DocUri(window.activeTextEditor.document)
        }

        window.onDidChangeActiveTextEditor(e => {
            if (e === undefined) {
                return
            }
            const docUri = FullDiagnosticsProvider.getLean4DocUri(e.document)
            if (docUri === undefined) {
                return
            }

            this.lastActiveLeanDocumentUri = docUri
        }, this.subscriptions)
        workspace.onDidCloseTextDocument(doc => {
            if (this.lastActiveLeanDocumentUri === undefined) {
                return
            }

            const docUri = FullDiagnosticsProvider.getLean4DocUri(doc)
            if (docUri === undefined) {
                return
            }

            if (extUriEquals(docUri, this.lastActiveLeanDocumentUri)) {
                this.lastActiveLeanDocumentUri = undefined
            }
        }, this.subscriptions)

        this.subscriptions.push(
            commands.registerCommand('lean4.troubleshooting.showSetupInformation', () =>
                this.performAndDisplayFullDiagnosis(),
            ),
        )
    }

    async performAndDisplayFullDiagnosis() {
        const projectUri =
            this.lastActiveLeanDocumentUri !== undefined && this.lastActiveLeanDocumentUri.scheme === 'file'
                ? await findLeanProjectRoot(this.lastActiveLeanDocumentUri)
                : undefined
        if (projectUri === 'FileNotFound') {
            displayError(
                `Cannot display setup information for file that does not exist in the file system: ${this.lastActiveLeanDocumentUri}. Please choose a different file to display the setup information for.`,
            )
            return
        }
        const fullDiagnostics = await performFullDiagnosis(this.outputChannel, projectUri)
        const formattedFullDiagnostics = formatFullDiagnostics(fullDiagnostics)
        const copyToClipboardInput = 'Copy to Clipboard'
        const choice = await displayInformationWithInput(formattedFullDiagnostics, copyToClipboardInput)
        if (choice === copyToClipboardInput) {
            await env.clipboard.writeText(formattedFullDiagnostics)
        }
    }

    private static getLean4DocUri(doc: TextDocument): ExtUri | undefined {
        if (doc.languageId !== 'lean4') {
            return undefined
        }
        return toExtUri(doc.uri)
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
