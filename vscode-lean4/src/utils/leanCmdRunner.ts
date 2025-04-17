import path from 'path'
import { ExtensionContext, OutputChannel } from 'vscode'
import { alwaysAskBeforeInstallingLeanVersions } from '../config'
import { batchExecuteWithProgress, ExecutionExitCode, ExecutionResult } from './batch'
import {
    elanDumpStateWithNet,
    ElanDumpStateWithNetResult,
    elanDumpStateWithoutNet,
    ElanDumpStateWithoutNetResult,
    elanInstallToolchain,
    ElanOverrideReason,
    ElanRemoteUnresolvedToolchain,
    ElanStateDump,
    ElanToolchains,
    ElanUnresolvedToolchain,
} from './elan'
import { FileUri } from './exturi'
import { displayNotification, displayNotificationWithInput } from './notifs'

export type ToolchainUpdateMode = 'UpdateAutomatically' | 'PromptAboutUpdate' | 'DoNotUpdate'

function shouldUpdateToolchainAutomatically(mode: ToolchainUpdateMode) {
    return !alwaysAskBeforeInstallingLeanVersions() && mode === 'UpdateAutomatically'
}

export type ToolchainDecisionOptions = {
    channel: OutputChannel | undefined
    cwdUri: FileUri | undefined
    context: string | undefined
    toolchainUpdateMode: ToolchainUpdateMode
    toolchain?: string | undefined
}

export type LeanCommandOptions = ToolchainDecisionOptions & {
    waitingPrompt: string
    translator?: ((line: string) => string | undefined) | undefined
}

function overrideReason(activeOverride: ElanOverrideReason | undefined): string | undefined {
    switch (activeOverride?.kind) {
        case undefined:
            return undefined
        case 'Environment':
            return undefined
        case 'Manual':
            return `set by \`elan override\` in folder '${activeOverride.directoryPath.baseName()}'`
        case 'ToolchainFile':
            return `of Lean project '${path.dirname(activeOverride.toolchainPath.fsPath)}'`
        case 'LeanpkgFile':
            return `of Lean project '${path.dirname(activeOverride.leanpkgPath.fsPath)}'`
        case 'ToolchainDirectory':
            return `of Lean project '${activeOverride.directoryPath.fsPath}'`
    }
}

function leanNotInstalledError(
    activeOverride: ElanOverrideReason | undefined,
    unresolvedActiveToolchain: ElanRemoteUnresolvedToolchain,
): string {
    const or = overrideReason(activeOverride)
    const formattedOverride = or !== undefined ? ' ' + or : ''
    if (unresolvedActiveToolchain.fromChannel !== undefined) {
        const prefix = activeOverride === undefined ? 'default ' : ''
        return `No Lean version for ${prefix}release channel '${ElanUnresolvedToolchain.toolchainName(unresolvedActiveToolchain)}'${formattedOverride} is installed.`
    } else {
        const prefix = activeOverride === undefined ? 'Default ' : ''
        return `${prefix}Lean version '${ElanUnresolvedToolchain.toolchainName(unresolvedActiveToolchain)}'${formattedOverride} is not installed.`
    }
}

function installationPrompt(
    activeOverride: ElanOverrideReason | undefined,
    unresolvedActiveToolchain: ElanRemoteUnresolvedToolchain,
): string {
    const error = leanNotInstalledError(activeOverride, unresolvedActiveToolchain)
    if (unresolvedActiveToolchain.fromChannel !== undefined) {
        return `${error}\n\n` + 'Do you wish to install one?'
    } else {
        return `${error}\n\n` + 'Do you wish to install it?'
    }
}

function updatePrompt(
    activeOverride: ElanOverrideReason | undefined,
    releaseChannel: string,
    cachedActiveToolchain: string,
    resolvedActiveToolchain: string,
): string {
    const prefix = activeOverride === undefined ? 'default ' : ''
    const reason = overrideReason(activeOverride)
    return (
        `Installed Lean version '${cachedActiveToolchain}' for ${prefix}release channel '${releaseChannel}'${reason !== undefined ? ' ' + reason : ''} is outdated.\n\n` +
        `Do you wish to install the new Lean version '${resolvedActiveToolchain}' or continue using the outdated Lean version?`
    )
}

function updateDecisionKey(cwdUri: FileUri | undefined, cachedToolchain: string): string {
    return JSON.stringify({
        cwdUri,
        cachedToolchain,
    })
}

export class LeanCommandRunner {
    private stickyUpdateDecisions: Map<string, 'DoNotUpdate'> = new Map<string, 'DoNotUpdate'>()

    private async runCmd(
        executablePath: string,
        args: string[],
        options: LeanCommandOptions,
        toolchain: string | undefined,
    ): Promise<ExecutionResult> {
        const toolchainOverride = toolchain ?? options.toolchain
        if (toolchainOverride !== undefined) {
            args = [`+${toolchainOverride}`, ...args]
        }
        return await batchExecuteWithProgress(executablePath, args, options.context, options.waitingPrompt, {
            cwd: options.cwdUri?.fsPath,
            channel: options.channel,
            translator: options.translator,
            allowCancellation: true,
        })
    }

    private async analyzeElanStateDumpWithoutNetResult(
        channel: OutputChannel | undefined,
        context: string | undefined,
        r: ElanDumpStateWithoutNetResult,
    ): Promise<
        | { kind: 'CheckForToolchainUpdate'; cachedToolchain: string }
        | { kind: 'RunWithActiveToolchain' }
        | { kind: 'Error'; message: string }
    > {
        const runWithActiveToolchain: { kind: 'RunWithActiveToolchain' } = { kind: 'RunWithActiveToolchain' }

        let elanState: ElanStateDump
        switch (r.kind) {
            case 'Success':
                elanState = r.state
                break
            case 'ElanNotFound':
                return runWithActiveToolchain
            case 'ExecutionError':
                return runWithActiveToolchain
        }

        const unresolvedToolchain = ElanToolchains.unresolvedToolchain(elanState.toolchains)
        const toolchainResolutionResult = elanState.toolchains.resolvedActive
        if (unresolvedToolchain === undefined || toolchainResolutionResult === undefined) {
            return runWithActiveToolchain
        }

        if (unresolvedToolchain.kind === 'Local') {
            return runWithActiveToolchain
        }

        const cachedToolchain = toolchainResolutionResult.cachedToolchain
        if (cachedToolchain === undefined) {
            const installNewToolchain: () => Promise<
                { kind: 'RunWithActiveToolchain' } | { kind: 'Error'; message: string }
            > = async () => {
                const elanInstallToolchainResult = await elanInstallToolchain(
                    channel,
                    context,
                    ElanUnresolvedToolchain.toolchainName(unresolvedToolchain),
                )
                switch (elanInstallToolchainResult.kind) {
                    case 'Success':
                    case 'ElanNotFound':
                    case 'ToolchainAlreadyInstalled':
                        return runWithActiveToolchain
                    case 'Error':
                        return {
                            kind: 'Error',
                            message:
                                leanNotInstalledError(
                                    elanState.toolchains.activeOverride?.reason,
                                    unresolvedToolchain,
                                ) + ` Reason: Installation failed. Error: ${elanInstallToolchainResult.message}`,
                        }
                    case 'Cancelled':
                        return {
                            kind: 'Error',
                            message:
                                leanNotInstalledError(
                                    elanState.toolchains.activeOverride?.reason,
                                    unresolvedToolchain,
                                ) + ' Reason: Installation was cancelled.',
                        }
                }
            }
            if (!alwaysAskBeforeInstallingLeanVersions()) {
                return await installNewToolchain()
            }
            const choice = await displayNotificationWithInput(
                'Information',
                installationPrompt(elanState.toolchains.activeOverride?.reason, unresolvedToolchain),
                ['Install Version'],
            )
            if (choice === undefined) {
                return {
                    kind: 'Error',
                    message: leanNotInstalledError(elanState.toolchains.activeOverride?.reason, unresolvedToolchain),
                }
            }
            choice satisfies 'Install Version'

            return await installNewToolchain()
        }

        if (unresolvedToolchain.fromChannel === undefined) {
            return runWithActiveToolchain
        }

        return { kind: 'CheckForToolchainUpdate', cachedToolchain }
    }

    private async analyzeElanDumpStateWithNetResult(
        channel: OutputChannel | undefined,
        context: string | undefined,
        toolchainUpdateMode: 'UpdateAutomatically' | 'PromptAboutUpdate',
        cachedToolchain: string,
        r: ElanDumpStateWithNetResult,
    ): Promise<
        | { kind: 'RunWithActiveToolchain' }
        | { kind: 'RunWithCachedToolchain'; warning: string | undefined }
        | { kind: 'Error'; message: string }
    > {
        const runWithActiveToolchain: { kind: 'RunWithActiveToolchain' } = { kind: 'RunWithActiveToolchain' }
        const runWithCachedToolchain: (warning: string | undefined) => {
            kind: 'RunWithCachedToolchain'
            warning: string | undefined
        } = warning => ({
            kind: 'RunWithCachedToolchain',
            warning,
        })

        let elanState: ElanStateDump
        switch (r.kind) {
            case 'Success':
                elanState = r.state
                break
            case 'ElanNotFound':
                return runWithActiveToolchain
            case 'ExecutionError':
                return runWithActiveToolchain
            case 'Cancelled':
                return runWithCachedToolchain(
                    `Lean version information query was cancelled, falling back to installed Lean version '${cachedToolchain}'.`,
                )
        }

        const unresolvedToolchain = ElanToolchains.unresolvedToolchain(elanState.toolchains)
        const toolchainResolutionResult = elanState.toolchains.resolvedActive
        if (unresolvedToolchain === undefined || toolchainResolutionResult === undefined) {
            return runWithActiveToolchain
        }

        if (unresolvedToolchain.kind === 'Local' || unresolvedToolchain.fromChannel === undefined) {
            return runWithActiveToolchain
        }

        const resolvedToolchainResult = toolchainResolutionResult.resolvedToolchain
        let resolvedToolchain: string
        switch (resolvedToolchainResult.kind) {
            case 'Error':
                return runWithCachedToolchain(
                    `Could not fetch Lean version information, falling back to installed Lean version '${cachedToolchain}'. Error: ${resolvedToolchainResult.message}`,
                )
            case 'Ok':
                resolvedToolchain = resolvedToolchainResult.value
                break
        }

        const willActiveToolchainBeUpdated = cachedToolchain !== resolvedToolchain
        if (!willActiveToolchainBeUpdated) {
            return runWithActiveToolchain
        }

        const isResolvedToolchainAlreadyInstalled = elanState.toolchains.installed.has(resolvedToolchain)
        if (isResolvedToolchainAlreadyInstalled) {
            return runWithActiveToolchain
        }

        const updateToolchain = async () => {
            const elanInstallToolchainResult = await elanInstallToolchain(
                channel,
                context,
                ElanUnresolvedToolchain.toolchainName(unresolvedToolchain),
            )
            switch (elanInstallToolchainResult.kind) {
                case 'Success':
                case 'ElanNotFound':
                case 'ToolchainAlreadyInstalled':
                    return runWithActiveToolchain
                case 'Error':
                    return runWithCachedToolchain(
                        `Could not update Lean version, falling back to installed Lean version '${cachedToolchain}'. Error: ${elanInstallToolchainResult.message}`,
                    )
                case 'Cancelled':
                    return runWithCachedToolchain(
                        `Lean version update was cancelled, falling back to installed Lean version '${cachedToolchain}'.`,
                    )
            }
        }

        if (shouldUpdateToolchainAutomatically(toolchainUpdateMode)) {
            return await updateToolchain()
        }

        const choice = await displayNotificationWithInput(
            'Information',
            updatePrompt(
                elanState.toolchains.activeOverride?.reason,
                ElanUnresolvedToolchain.toolchainName(unresolvedToolchain),
                cachedToolchain,
                resolvedToolchain,
            ),
            ['Update Lean Version'],
            'Use Old Version',
        )
        if (choice === undefined || choice === 'Use Old Version') {
            return runWithCachedToolchain(undefined)
        }
        choice satisfies 'Update Lean Version'
        return await updateToolchain()
    }

    async decideToolchain(
        options: ToolchainDecisionOptions,
    ): Promise<
        | { kind: 'RunWithActiveToolchain' }
        | { kind: 'RunWithSpecificToolchain'; toolchain: string }
        | { kind: 'Error'; message: string }
    > {
        const elanStateDumpWithoutNetResult = await elanDumpStateWithoutNet(options.cwdUri, options.toolchain)
        const withoutNetAnalysisResult = await this.analyzeElanStateDumpWithoutNetResult(
            options.channel,
            options.context,
            elanStateDumpWithoutNetResult,
        )
        if (withoutNetAnalysisResult.kind !== 'CheckForToolchainUpdate') {
            return withoutNetAnalysisResult
        }

        const cachedToolchain = withoutNetAnalysisResult.cachedToolchain
        const key = updateDecisionKey(options.cwdUri, cachedToolchain)
        if (
            options.toolchainUpdateMode === 'DoNotUpdate' ||
            (!shouldUpdateToolchainAutomatically(options.toolchainUpdateMode) &&
                this.stickyUpdateDecisions.get(key) === 'DoNotUpdate')
        ) {
            return { kind: 'RunWithSpecificToolchain', toolchain: cachedToolchain }
        }

        const elanStateDumpWithNetResult = await elanDumpStateWithNet(
            options.cwdUri,
            options.context,
            options.toolchain,
        )
        const withNetAnalysisResult = await this.analyzeElanDumpStateWithNetResult(
            options.channel,
            options.context,
            options.toolchainUpdateMode,
            cachedToolchain,
            elanStateDumpWithNetResult,
        )
        if (withNetAnalysisResult.kind === 'RunWithCachedToolchain') {
            this.stickyUpdateDecisions.set(key, 'DoNotUpdate')
            if (withNetAnalysisResult.warning !== undefined) {
                displayNotification('Warning', withNetAnalysisResult.warning)
            }
            return { kind: 'RunWithSpecificToolchain', toolchain: cachedToolchain }
        }
        return withNetAnalysisResult
    }

    async runLeanCommand(
        executablePath: string,
        args: string[],
        options: LeanCommandOptions,
    ): Promise<ExecutionResult> {
        const toolchainDecision = await this.decideToolchain(options)
        if (toolchainDecision.kind === 'Error') {
            return {
                exitCode: ExecutionExitCode.ExecutionError,
                stdout: toolchainDecision.message,
                stderr: '',
                combined: toolchainDecision.message,
            }
        }
        if (toolchainDecision.kind === 'RunWithActiveToolchain') {
            return await this.runCmd(executablePath, args, options, undefined)
        }
        toolchainDecision.kind satisfies 'RunWithSpecificToolchain'
        return await this.runCmd(executablePath, args, options, toolchainDecision.toolchain)
    }
}

export let leanRunner: LeanCommandRunner

/** Must be called at the very start when the extension is activated so that `leanRunner` is defined. */
export function registerLeanCommandRunner(context: ExtensionContext) {
    leanRunner = new LeanCommandRunner()
    context.subscriptions.push({
        dispose: () => {
            const u: any = undefined
            // Implicit invariant: When the extension deactivates, `leanRunner` is not called after this assignment.
            leanRunner = u
        },
    })
}
