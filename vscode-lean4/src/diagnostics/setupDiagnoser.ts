import * as os from 'os'
import { SemVer } from 'semver'
import { OutputChannel } from 'vscode'
import { ExecutionExitCode, ExecutionResult, batchExecute, batchExecuteWithProgress } from '../utils/batch'
import { FileUri } from '../utils/exturi'
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

export function versionQueryResult(executionResult: ExecutionResult, versionRegex: RegExp): VersionQueryResult {
    if (executionResult.exitCode === ExecutionExitCode.CannotLaunch) {
        return { kind: 'CommandNotFound' }
    }

    if (executionResult.exitCode === ExecutionExitCode.ExecutionError) {
        return { kind: 'CommandError', message: executionResult.combined }
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
    readonly toolchain: string | undefined

    constructor(channel: OutputChannel, cwdUri: FileUri | undefined, toolchain?: string | undefined) {
        this.channel = channel
        this.cwdUri = cwdUri
        this.toolchain = toolchain
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
        const lakeVersionResult = await this.runLeanCommand('lake', ['--version'], 'Checking Lake version')
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

    private async runWithProgress(executablePath: string, args: string[], title: string): Promise<ExecutionResult> {
        return batchExecuteWithProgress(executablePath, args, title, {
            cwd: this.cwdUri?.fsPath,
            channel: this.channel,
        })
    }

    private async runLeanCommand(executablePath: string, args: string[], title: string) {
        const leanArgs = [...args]
        if (this.toolchain !== undefined) {
            leanArgs.unshift(`+${this.toolchain}`)
        }
        return await this.runWithProgress(executablePath, leanArgs, title)
    }
}

export function diagnose(
    channel: OutputChannel,
    cwdUri: FileUri | undefined,
    toolchain?: string | undefined,
): SetupDiagnoser {
    return new SetupDiagnoser(channel, cwdUri, toolchain)
}
