import * as os from 'os'
import { SemVer } from 'semver'
import { Disposable, OutputChannel, TextDocument, commands, env, window, workspace } from 'vscode'
import { shouldShowSetupWarnings } from '../config'
import { ExecutionExitCode, ExecutionResult, batchExecute, batchExecuteWithProgress } from './batch'
import { displayErrorWithOutput, displayWarningWithOutput } from './errors'
import { ExtUri, FileUri, extUriEquals, toExtUri } from './exturi'
import { checkParentFoldersForLeanProject, findLeanProjectRoot, isValidLeanProject } from './projectInfo'

export type SystemQueryResult = {
    operatingSystem: string
    cpuArchitecture: string
    cpuModels: string
    totalMemory: string
}

export type VersionQueryResult =
    | { kind: 'Success'; version: SemVer }
    | { kind: 'CommandNotFound' }
    | { kind: 'CommandError'; message: string }
    | { kind: 'InvalidVersion'; versionResult: string }

const recommendedElanVersion = new SemVer('3.1.1')

export type ElanVersionDiagnosis =
    | { kind: 'UpToDate'; version: SemVer }
    | { kind: 'Outdated'; currentVersion: SemVer; recommendedVersion: SemVer }
    | { kind: 'NotInstalled' }
    | { kind: 'ExecutionError'; message: string }

export type ProjectSetupDiagnosis =
    | { kind: 'SingleFile' }
    | { kind: 'MissingLeanToolchain'; folder: FileUri; parentProjectFolder: FileUri | undefined }
    | { kind: 'ValidProjectSetup'; projectFolder: FileUri }

export type LeanVersionDiagnosis =
    | { kind: 'UpToDate'; version: SemVer }
    | { kind: 'IsLean3Version'; version: SemVer }
    | { kind: 'IsAncientLean4Version'; version: SemVer }
    | { kind: 'NotInstalled' }
    | { kind: 'ExecutionError'; message: string }

export enum PreconditionCheckResult {
    Fulfilled = 0,
    Warning = 1,
    Fatal = 2,
}

export function worstPreconditionViolation(
    a: PreconditionCheckResult,
    b: PreconditionCheckResult,
): PreconditionCheckResult {
    return Math.max(a, b)
}

export function versionQueryResult(executionResult: ExecutionResult, versionRegex: RegExp): VersionQueryResult {
    if (executionResult.exitCode === ExecutionExitCode.CannotLaunch) {
        return { kind: 'CommandNotFound' }
    }

    if (executionResult.exitCode === ExecutionExitCode.ExecutionError) {
        return { kind: 'CommandError', message: executionResult.stdout }
    }

    const match = versionRegex.exec(executionResult.stdout)
    if (!match) {
        return { kind: 'InvalidVersion', versionResult: executionResult.stdout }
    }

    return { kind: 'Success', version: new SemVer(match[1]) }
}

export function checkElanVersion(elanVersionResult: VersionQueryResult): ElanVersionDiagnosis {
    switch (elanVersionResult.kind) {
        case 'CommandNotFound':
            return { kind: 'NotInstalled' }

        case 'CommandError':
            return { kind: 'ExecutionError', message: elanVersionResult.message }

        case 'InvalidVersion':
            return {
                kind: 'ExecutionError',
                message: `Invalid Elan version format: '${elanVersionResult.versionResult}'`,
            }

        case 'Success':
            if (elanVersionResult.version.compare(recommendedElanVersion) < 0) {
                return {
                    kind: 'Outdated',
                    currentVersion: elanVersionResult.version,
                    recommendedVersion: recommendedElanVersion,
                }
            }
            return { kind: 'UpToDate', version: elanVersionResult.version }
    }
}

export function checkLeanVersion(leanVersionResult: VersionQueryResult): LeanVersionDiagnosis {
    if (leanVersionResult.kind === 'CommandNotFound') {
        return { kind: 'NotInstalled' }
    }

    if (leanVersionResult.kind === 'CommandError') {
        return {
            kind: 'ExecutionError',
            message: leanVersionResult.message,
        }
    }

    if (leanVersionResult.kind === 'InvalidVersion') {
        return {
            kind: 'ExecutionError',
            message: `Invalid Lean version format: '${leanVersionResult.versionResult}'`,
        }
    }

    const leanVersion = leanVersionResult.version
    if (leanVersion.major === 3) {
        return { kind: 'IsLean3Version', version: leanVersion }
    }

    if (leanVersion.major === 4 && leanVersion.minor === 0 && leanVersion.prerelease.length > 0) {
        return { kind: 'IsAncientLean4Version', version: leanVersion }
    }

    return { kind: 'UpToDate', version: leanVersion }
}

export class SetupDiagnoser {
    readonly channel: OutputChannel
    readonly cwdUri: FileUri | undefined

    constructor(channel: OutputChannel, cwdUri: FileUri | undefined) {
        this.channel = channel
        this.cwdUri = cwdUri
    }

    async checkCurlAvailable(): Promise<boolean> {
        const curlVersionResult = await this.runSilently('curl', ['--version'])
        return curlVersionResult.exitCode === ExecutionExitCode.Success
    }

    async checkGitAvailable(): Promise<boolean> {
        const gitVersionResult = await this.runSilently('git', ['--version'])
        return gitVersionResult.exitCode === ExecutionExitCode.Success
    }

    async queryLakeVersion(): Promise<VersionQueryResult> {
        const lakeVersionResult = await this.runWithProgress('lake', ['--version'], 'Checking Lake version')
        return versionQueryResult(lakeVersionResult, /version (\d+\.\d+\.\d+(\w|-)*)/)
    }

    async checkLakeAvailable(): Promise<boolean> {
        const lakeVersionResult = await this.queryLakeVersion()
        return lakeVersionResult.kind === 'Success'
    }

    querySystemInformation(): SystemQueryResult {
        const cpuModels = os.cpus().map(cpu => cpu.model)
        const groupedCpuModels = new Map<string, number>()
        for (const cpuModel of cpuModels) {
            const counter: number | undefined = groupedCpuModels.get(cpuModel)
            if (counter === undefined) {
                groupedCpuModels.set(cpuModel, 1)
            } else {
                groupedCpuModels.set(cpuModel, counter + 1)
            }
        }
        const formattedCpuModels = Array.from(groupedCpuModels.entries())
            .map(([cpuModel, amount]) => `${amount} x ${cpuModel}`)
            .join(', ')

        const totalMemory = (os.totalmem() / 1_000_000_000).toFixed(2)

        return {
            operatingSystem: `${os.type()} (release: ${os.release()})`,
            cpuArchitecture: os.arch(),
            cpuModels: formattedCpuModels,
            totalMemory: `${totalMemory} GB`,
        }
    }

    async queryLeanVersion(): Promise<VersionQueryResult> {
        const leanVersionResult = await this.runWithProgress('lean', ['--version'], 'Checking Lean version')
        return versionQueryResult(leanVersionResult, /version (\d+\.\d+\.\d+(\w|-)*)/)
    }

    async queryElanVersion(): Promise<VersionQueryResult> {
        const elanVersionResult = await this.runSilently('elan', ['--version'])
        return versionQueryResult(elanVersionResult, /elan (\d+\.\d+\.\d+)/)
    }

    async elan(): Promise<ElanVersionDiagnosis> {
        const elanVersionResult = await this.queryElanVersion()
        return checkElanVersion(elanVersionResult)
    }

    async projectSetup(): Promise<ProjectSetupDiagnosis> {
        if (this.cwdUri === undefined) {
            return { kind: 'SingleFile' }
        }

        if (!(await isValidLeanProject(this.cwdUri))) {
            const parentProjectFolder: FileUri | undefined = await checkParentFoldersForLeanProject(this.cwdUri)
            return { kind: 'MissingLeanToolchain', folder: this.cwdUri, parentProjectFolder }
        }

        return { kind: 'ValidProjectSetup', projectFolder: this.cwdUri }
    }

    async projectLeanVersion(): Promise<LeanVersionDiagnosis> {
        const leanVersionResult = await this.queryLeanVersion()
        return checkLeanVersion(leanVersionResult)
    }

    private async runSilently(executablePath: string, args: string[]): Promise<ExecutionResult> {
        return batchExecute(executablePath, args, this.cwdUri?.fsPath, { combined: this.channel })
    }

    private async runWithProgress(executablePath: string, args: string[], title: string): Promise<ExecutionResult> {
        return batchExecuteWithProgress(executablePath, args, title, {
            cwd: this.cwdUri?.fsPath,
            channel: this.channel,
        })
    }
}

export function diagnose(channel: OutputChannel, cwdUri: FileUri | undefined): SetupDiagnoser {
    return new SetupDiagnoser(channel, cwdUri)
}

export type FullDiagnostics = {
    systemInfo: SystemQueryResult
    isCurlAvailable: boolean
    isGitAvailable: boolean
    elanVersionDiagnosis: ElanVersionDiagnosis
    leanVersionDiagnosis: LeanVersionDiagnosis
    projectSetupDiagnosis: ProjectSetupDiagnosis
}

function formatElanVersionDiagnosis(d: ElanVersionDiagnosis): string {
    switch (d.kind) {
        case 'UpToDate':
            return `Reasonably up-to-date (version: ${d.version.toString()})`
        case 'Outdated':
            return `Outdated (version: ${d.currentVersion.toString()}, recommended version: ${d.recommendedVersion.toString()})`
        case 'ExecutionError':
            const errorMessage = d.message
                .split('\n')
                .map(line => '    ' + line)
                .join('\n')
            return 'Execution error:\n' + errorMessage
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
            const errorMessage = d.message
                .split('\n')
                .map(line => '    ' + line)
                .join('\n')
            return 'Execution error:\n' + errorMessage
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

export function formatFullDiagnostics(d: FullDiagnostics): string {
    return [
        `Operating system: ${d.systemInfo.operatingSystem}`,
        `CPU architecture: ${d.systemInfo.cpuArchitecture}`,
        `CPU model: ${d.systemInfo.cpuModels}`,
        `Available RAM: ${d.systemInfo.totalMemory}`,
        '',
        `Curl installed: ${d.isCurlAvailable}`,
        `Git installed: ${d.isGitAvailable}`,
        `Elan: ${formatElanVersionDiagnosis(d.elanVersionDiagnosis)}`,
        `Lean: ${formatLeanVersionDiagnosis(d.leanVersionDiagnosis)}`,
        `Project: ${formatProjectSetupDiagnosis(d.projectSetupDiagnosis)}`,
    ].join('\n')
}

export async function performFullDiagnosis(
    channel: OutputChannel,
    cwdUri: FileUri | undefined,
): Promise<FullDiagnostics> {
    const diagnose = new SetupDiagnoser(channel, cwdUri)
    return {
        systemInfo: diagnose.querySystemInformation(),
        isCurlAvailable: await diagnose.checkCurlAvailable(),
        isGitAvailable: await diagnose.checkGitAvailable(),
        elanVersionDiagnosis: await diagnose.elan(),
        leanVersionDiagnosis: await diagnose.projectLeanVersion(),
        projectSetupDiagnosis: await diagnose.projectSetup(),
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
        const fullDiagnostics = await performFullDiagnosis(this.outputChannel, projectUri)
        const formattedFullDiagnostics = formatFullDiagnostics(fullDiagnostics)
        const copyToClipboardInput = 'Copy to Clipboard'
        const choice = await window.showInformationMessage(
            formattedFullDiagnostics,
            { modal: true },
            copyToClipboardInput,
        )
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

export async function showSetupError<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return await window.showErrorMessage(message, ...items)
}

export async function showSetupErrorWithOutput(message: string) {
    return await displayErrorWithOutput(message)
}

export async function showSetupWarning<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    if (!shouldShowSetupWarnings()) {
        return undefined
    }
    return await window.showWarningMessage(message, ...items)
}

export async function showSetupWarningWithOutput(message: string) {
    if (!shouldShowSetupWarnings()) {
        return
    }
    return await displayWarningWithOutput(message)
}
