import * as os from 'os'
import { SemVer } from 'semver'
import { OutputChannel, extensions, version } from 'vscode'
import { ExecutionExitCode, ExecutionResult, batchExecute } from '../utils/batch'
import {
    ElanDumpStateWithNetResult,
    ElanDumpStateWithoutNetResult,
    elanDumpStateWithNet,
    elanDumpStateWithoutNet,
    isElanEagerResolutionVersion,
} from '../utils/elan'
import { FileUri } from '../utils/exturi'
import { ToolchainUpdateMode, leanRunner } from '../utils/leanCmdRunner'
import { checkParentFoldersForLeanProject, isValidLeanProject } from '../utils/projectInfo'

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
    | { kind: 'Cancelled' }
    | { kind: 'InvalidVersion'; versionResult: string }

export type LakeAvailabilityResult =
    | { kind: 'Available' }
    | { kind: 'NotAvailable' }
    | { kind: 'Error'; message: string }
    | { kind: 'Cancelled' }
export type ElanDumpStateWithoutNetQueryResult = ElanDumpStateWithoutNetResult | { kind: 'PreEagerResolutionVersion' }
export type ElanDumpStateWithNetQueryResult = ElanDumpStateWithNetResult | { kind: 'PreEagerResolutionVersion' }

const recommendedElanVersion = new SemVer('3.1.1')
// Should be bumped in a release *before* we bump the version requirement of the VS Code extension so that
// users know that they need to update and do not get stuck on an old VS Code version.
const recommendedVSCodeVersion = new SemVer('1.75.0')

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
    | { kind: 'Cancelled' }
    | { kind: 'ExecutionError'; message: string }

export type VSCodeVersionDiagnosis =
    | { kind: 'UpToDate'; version: SemVer }
    | { kind: 'Outdated'; currentVersion: SemVer; recommendedVersion: SemVer }

export function versionQueryResult(executionResult: ExecutionResult, versionRegex: RegExp): VersionQueryResult {
    if (executionResult.exitCode === ExecutionExitCode.CannotLaunch) {
        return { kind: 'CommandNotFound' }
    }

    if (executionResult.exitCode === ExecutionExitCode.ExecutionError) {
        return { kind: 'CommandError', message: executionResult.combined }
    }

    if (executionResult.exitCode === ExecutionExitCode.Cancelled) {
        return { kind: 'Cancelled' }
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

        case 'Cancelled':
            throw new Error('Unexpected cancellation of `elan --version` query.')

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

    if (leanVersionResult.kind === 'Cancelled') {
        return { kind: 'Cancelled' }
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

export type SetupDiagnoserOptions = {
    channel: OutputChannel | undefined
    cwdUri: FileUri | undefined
    context?: string | undefined
    toolchain?: string | undefined
    toolchainUpdateMode?: ToolchainUpdateMode | undefined
}

export class SetupDiagnoser {
    readonly channel: OutputChannel | undefined
    readonly cwdUri: FileUri | undefined
    readonly context: string | undefined
    readonly toolchain: string | undefined
    readonly toolchainUpdateMode: ToolchainUpdateMode | undefined

    constructor(options: SetupDiagnoserOptions) {
        this.channel = options.channel
        this.cwdUri = options.cwdUri
        this.context = options.context
        this.toolchain = options.toolchain
        this.toolchainUpdateMode = options.toolchainUpdateMode
    }

    async checkCurlAvailable(): Promise<boolean> {
        const curlVersionResult = await this.runSilently('curl', ['--version'])
        return curlVersionResult.exitCode === ExecutionExitCode.Success
    }

    async checkGitAvailable(): Promise<boolean> {
        const gitVersionResult = await this.runSilently('git', ['--version'])
        return gitVersionResult.exitCode === ExecutionExitCode.Success
    }

    async checkLakeAvailable(): Promise<LakeAvailabilityResult> {
        const lakeVersionResult = await this.runLeanCommand('lake', ['--version'], 'Checking Lake version')
        switch (lakeVersionResult.exitCode) {
            case ExecutionExitCode.Success:
                return { kind: 'Available' }
            case ExecutionExitCode.CannotLaunch:
                return { kind: 'NotAvailable' }
            case ExecutionExitCode.ExecutionError:
                return { kind: 'Error', message: lakeVersionResult.combined }
            case ExecutionExitCode.Cancelled:
                return { kind: 'Cancelled' }
        }
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

    queryExtensionVersion(): SemVer {
        return new SemVer(extensions.getExtension('leanprover.lean4')!.packageJSON.version)
    }

    queryVSCodeVersion(): VSCodeVersionDiagnosis {
        const currentVSCodeVersion = new SemVer(version)
        if (currentVSCodeVersion.compare(recommendedVSCodeVersion) < 0) {
            return {
                kind: 'Outdated',
                currentVersion: currentVSCodeVersion,
                recommendedVersion: recommendedVSCodeVersion,
            }
        }
        return { kind: 'UpToDate', version: currentVSCodeVersion }
    }

    async queryLeanVersion(): Promise<VersionQueryResult> {
        const leanVersionResult = await this.runLeanCommand('lean', ['--version'], 'Checking Lean version')
        return versionQueryResult(leanVersionResult, /version (\d+\.\d+\.\d+(\w|-)*)/)
    }

    async queryElanVersion(): Promise<VersionQueryResult> {
        const elanVersionResult = await this.runSilently('elan', ['--version'])
        return versionQueryResult(elanVersionResult, /elan (\d+\.\d+\.\d+)/)
    }

    async queryElanShow(): Promise<ExecutionResult> {
        return await this.runSilently('elan', ['show'])
    }

    async queryElanStateDumpWithoutNet(): Promise<ElanDumpStateWithoutNetQueryResult> {
        const dumpStateResult = await elanDumpStateWithoutNet(this.cwdUri, this.toolchain)
        if (dumpStateResult.kind === 'ExecutionError') {
            const versionResult = await this.queryElanVersion()
            if (versionResult.kind === 'Success' && !isElanEagerResolutionVersion(versionResult.version)) {
                return { kind: 'PreEagerResolutionVersion' }
            }
        }
        return dumpStateResult
    }

    async queryElanStateDumpWithNet(): Promise<ElanDumpStateWithNetQueryResult> {
        const dumpStateResult = await elanDumpStateWithNet(this.cwdUri, this.toolchain)
        if (dumpStateResult.kind === 'ExecutionError') {
            const versionResult = await this.queryElanVersion()
            if (versionResult.kind === 'Success' && !isElanEagerResolutionVersion(versionResult.version)) {
                return { kind: 'PreEagerResolutionVersion' }
            }
        }
        return dumpStateResult
    }

    async elanVersion(): Promise<ElanVersionDiagnosis> {
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

    async leanVersion(): Promise<LeanVersionDiagnosis> {
        const leanVersionResult = await this.queryLeanVersion()
        return checkLeanVersion(leanVersionResult)
    }

    private async runSilently(executablePath: string, args: string[]): Promise<ExecutionResult> {
        return batchExecute(executablePath, args, this.cwdUri?.fsPath, { combined: this.channel })
    }

    private async runLeanCommand(executablePath: string, args: string[], title: string): Promise<ExecutionResult> {
        return await leanRunner.runLeanCommand(executablePath, args, {
            channel: this.channel,
            context: this.context,
            cwdUri: this.cwdUri,
            waitingPrompt: title,
            toolchain: this.toolchain,
            toolchainUpdateMode: this.toolchainUpdateMode ?? 'UpdateAutomatically',
        })
    }
}

export function diagnose(options: SetupDiagnoserOptions): SetupDiagnoser {
    return new SetupDiagnoser(options)
}
