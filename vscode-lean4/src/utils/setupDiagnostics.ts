import { SemVer } from 'semver'
import { OutputChannel } from 'vscode'
import { batchExecute, ExecutionExitCode, ExecutionResult } from './batch'
import { FileUri } from './exturi'
import { checkParentFoldersForLeanProject, isValidLeanProject } from './projectInfo'

export type VersionQueryResult =
    | { kind: 'Success'; version: SemVer }
    | { kind: 'CommandNotFound' }
    | { kind: 'CommandError'; message: string }
    | { kind: 'InvalidVersion'; versionResult: string }

const recommendedElanVersion = new SemVer('3.1.1')

export type ElanDiagnosis =
    | { kind: 'UpToDate' }
    | { kind: 'Outdated'; currentVersion: SemVer; recommendedVersion: SemVer }
    | { kind: 'NotInstalled' }
    | { kind: 'ExecutionError'; message: string }

export type ProjectSetupDiagnosis =
    | { kind: 'SingleFile' }
    | { kind: 'MissingLeanToolchain'; parentProjectFolder: FileUri | undefined }
    | { kind: 'ValidProjectSetup' }

export type LeanVersionDiagnosis =
    | { kind: 'Error'; message: string }
    | { kind: 'IsLean3Version'; version: SemVer }
    | { kind: 'IsAncientLean4Version'; version: SemVer }
    | { kind: 'UpToDate' }

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
        return { kind: 'CommandError', message: executionResult.stderr }
    }

    const match = versionRegex.exec(executionResult.stdout)
    if (!match) {
        return { kind: 'InvalidVersion', versionResult: executionResult.stdout }
    }

    return { kind: 'Success', version: new SemVer(match[1]) }
}

export class SetupDiagnoser {
    readonly channel: OutputChannel
    readonly cwdUri: FileUri | undefined

    constructor(channel: OutputChannel, cwdUri: FileUri | undefined) {
        this.channel = channel
        this.cwdUri = cwdUri
    }

    async checkLakeAvailable(): Promise<boolean> {
        const lakeVersionResult = await this.runSilently('lake', ['--version'])
        return lakeVersionResult.exitCode === ExecutionExitCode.Success
    }

    async checkCurlAvailable(): Promise<boolean> {
        const curlVersionResult = await this.runSilently('curl', ['--version'])
        return curlVersionResult.exitCode === ExecutionExitCode.Success
    }

    async checkGitAvailable(): Promise<boolean> {
        const gitVersionResult = await this.runSilently('git', ['--version'])
        return gitVersionResult.exitCode === ExecutionExitCode.Success
    }

    async queryLeanVersion(toolchain?: string | undefined): Promise<VersionQueryResult> {
        const options = toolchain ? ['--version', '+' + toolchain] : ['--version']
        const leanVersionResult = await this.runSilently('lean', options)
        return versionQueryResult(leanVersionResult, /version (\d+\.\d+\.\d+(\w|-)*)/)
    }

    async queryElanVersion(): Promise<VersionQueryResult> {
        const elanVersionResult = await this.runSilently('elan', ['--version'])
        return versionQueryResult(elanVersionResult, /elan (\d+\.\d+\.\d+)/)
    }

    async elan(): Promise<ElanDiagnosis> {
        const elanVersionResult = await this.queryElanVersion()
        switch (elanVersionResult.kind) {
            case 'CommandNotFound':
                return { kind: 'NotInstalled' }

            case 'CommandError':
                return { kind: 'ExecutionError', message: elanVersionResult.message }

            case 'InvalidVersion':
                return {
                    kind: 'ExecutionError',
                    message: `Invalid version format: '${elanVersionResult.versionResult}'`,
                }

            case 'Success':
                if (elanVersionResult.version.compare(recommendedElanVersion) < 0) {
                    return {
                        kind: 'Outdated',
                        currentVersion: elanVersionResult.version,
                        recommendedVersion: recommendedElanVersion,
                    }
                }
                return { kind: 'UpToDate' }
        }
    }

    async projectSetup(): Promise<ProjectSetupDiagnosis> {
        if (this.cwdUri === undefined) {
            return { kind: 'SingleFile' }
        }

        if (!(await isValidLeanProject(this.cwdUri))) {
            const parentProjectFolder: FileUri | undefined = await checkParentFoldersForLeanProject(this.cwdUri)
            return { kind: 'MissingLeanToolchain', parentProjectFolder }
        }

        return { kind: 'ValidProjectSetup' }
    }

    async projectLeanVersion(): Promise<LeanVersionDiagnosis> {
        const leanVersionResult = await this.queryLeanVersion()
        if (leanVersionResult.kind === 'CommandNotFound') {
            return {
                kind: 'Error',
                message: "Error while checking Lean version: 'lean' command was not found.",
            }
        }
        if (leanVersionResult.kind === 'CommandError') {
            return {
                kind: 'Error',
                message: `Error while checking Lean version: ${leanVersionResult.message}`,
            }
        }
        if (leanVersionResult.kind === 'InvalidVersion') {
            return {
                kind: 'Error',
                message: `Error while checking Lean version: 'lean --version' returned a version that could not be parsed: '${leanVersionResult.versionResult}'`,
            }
        }

        const leanVersion = leanVersionResult.version
        if (leanVersion.major === 3) {
            return { kind: 'IsLean3Version', version: leanVersion }
        }

        if (leanVersion.major === 4 && leanVersion.minor === 0 && leanVersion.prerelease.length > 0) {
            return { kind: 'IsAncientLean4Version', version: leanVersion }
        }

        return { kind: 'UpToDate' }
    }

    private async runSilently(executablePath: string, args: string[]): Promise<ExecutionResult> {
        return batchExecute(executablePath, args, this.cwdUri?.fsPath, { combined: this.channel })
    }
}

export function diagnose(channel: OutputChannel, cwdUri: FileUri | undefined): SetupDiagnoser {
    return new SetupDiagnoser(channel, cwdUri)
}
