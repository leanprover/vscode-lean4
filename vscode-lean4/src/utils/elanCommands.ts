import assert from 'assert'
import { promises } from 'fs'
import { SemVer, valid } from 'semver'
import { commands, Disposable, OutputChannel, QuickPickItem, QuickPickItemKind, window } from 'vscode'
import { ExecutionExitCode } from './batch'
import { LeanClientProvider } from './clientProvider'
import {
    ActiveToolchainInfo,
    elanActiveToolchain,
    elanEagerResolutionMajorVersion,
    elanInstalledToolchains,
    elanInstallToolchain,
    elanNightlyChannel,
    elanQueryGc,
    elanSetDefaultToolchain,
    elanStableChannel,
    elanUninstallToolchains,
    elanVersion,
    isElanEagerResolutionVersion,
    toolchainVersion,
} from './elan'
import { FileUri, UntitledUri } from './exturi'
import { fileExists } from './fsHelper'
import { groupByKey } from './groupBy'
import { displayNotification, displayNotificationWithInput } from './notifs'
import { LeanReleaseChannel, queryLeanReleases } from './releaseQuery'

function displayElanNotInstalledError() {
    displayNotification('Error', 'Elan is not installed.')
}

type LeanToolchain =
    | { kind: 'Unknown'; fullName: string }
    | { kind: 'Release'; fullName: string; version: SemVer }
    | { kind: 'Nightly'; fullName: string; date: Date }
    | { kind: 'PRRelease'; fullName: string; pr: number }

function parseToolchain(toolchain: string): LeanToolchain {
    const releaseMatch = toolchain.match(/leanprover\/lean4:(.+)/)
    if (releaseMatch) {
        let version = releaseMatch[1]
        if (version[0] === 'v') {
            version = version.substring(1)
        }
        if (valid(version)) {
            return { kind: 'Release', fullName: toolchain, version: new SemVer(version) }
        }
    }

    const nightlyMatch = toolchain.match(/leanprover\/lean4-nightly:nightly-(.+)/)
    if (nightlyMatch) {
        const date = new Date(nightlyMatch[1])
        if (!isNaN(date.valueOf())) {
            return { kind: 'Nightly', fullName: toolchain, date }
        }
    }

    const prReleaseMatch = toolchain.match(/leanprover\/lean4-pr-releases:pr-release-(\d+)/)
    if (prReleaseMatch) {
        const pr = Number.parseInt(prReleaseMatch[1])
        return { kind: 'PRRelease', fullName: toolchain, pr }
    }

    return { kind: 'Unknown', fullName: toolchain }
}

function toolchainKindPrio(k: 'Unknown' | 'Release' | 'Nightly' | 'PRRelease'): number {
    switch (k) {
        case 'Unknown':
            return 3
        case 'Release':
            return 2
        case 'Nightly':
            return 1
        case 'PRRelease':
            return 0
    }
}

function compareToolchainKinds(
    k1: 'Unknown' | 'Release' | 'Nightly' | 'PRRelease',
    k2: 'Unknown' | 'Release' | 'Nightly' | 'PRRelease',
): number {
    return toolchainKindPrio(k1) - toolchainKindPrio(k2)
}

function compareToolchains(t1: LeanToolchain, t2: LeanToolchain): number {
    const kindComparison = compareToolchainKinds(t1.kind, t2.kind)
    if (kindComparison !== 0) {
        return kindComparison
    }
    switch (t1.kind) {
        case 'Unknown':
            assert(t2.kind === 'Unknown')
            return -1 * t1.fullName.localeCompare(t2.fullName)
        case 'Release':
            assert(t2.kind === 'Release')
            return t1.version.compare(t2.version)
        case 'Nightly':
            assert(t2.kind === 'Nightly')
            return t1.date.valueOf() - t2.date.valueOf()
        case 'PRRelease':
            assert(t2.kind === 'PRRelease')
            return t1.pr - t2.pr
    }
}

function sortToolchains(ts: string[]): string[] {
    return ts
        .map(t => parseToolchain(t))
        .sort((t1, t2) => -1 * compareToolchains(t1, t2))
        .map(t => t.fullName)
}

export class ElanCommandProvider implements Disposable {
    private subscriptions: Disposable[] = []

    private clientProvider: LeanClientProvider | undefined

    constructor(private channel: OutputChannel) {
        this.subscriptions.push(
            commands.registerCommand('lean4.setup.selectDefaultToolchain', () => this.selectDefaultToolchain()),
            commands.registerCommand('lean4.setup.updateReleaseChannel', () => this.updateReleaseChannel()),
            commands.registerCommand('lean4.setup.uninstallToolchains', () => this.uninstallToolchains()),
            commands.registerCommand('lean4.project.selectProjectToolchain', () => this.selectProjectToolchain()),
        )
    }

    setClientProvider(clientProvider: LeanClientProvider) {
        this.clientProvider = clientProvider
    }

    async selectDefaultToolchain() {
        if (!(await this.checkElanSupportsDumpState())) {
            return
        }

        const selectDefaultToolchainContext = 'Select Default Lean Version'
        const selectedDefaultToolchain = await this.displayToolchainSelectionQuickPick(
            selectDefaultToolchainContext,
            'Select default Lean version',
            true,
        )
        if (selectedDefaultToolchain === undefined) {
            return
        }

        let prompt: string
        if (selectedDefaultToolchain === elanStableChannel) {
            prompt =
                `This operation will set the '${selectedDefaultToolchain}' Lean release channel to be the global default Lean release channel.\n` +
                'This means that the most recent stable Lean version at any given time will be used for files in VS Code that do not belong to a Lean project, as well as for Lean commands on the command line outside of Lean projects.\n' +
                'When a new stable Lean version becomes available, VS Code will issue a prompt about whether to update to the most recent Lean version. On the command line, the new stable Lean version will be downloaded automatically without a prompt.\n\n' +
                'Do you wish to proceed?'
        } else {
            prompt =
                `This operation will set '${selectedDefaultToolchain}' to be the global default Lean version.\n` +
                'This means that it will be used for files in VS Code that do not belong to a Lean project, as well as for Lean commands on the command line outside of Lean projects.\n\n' +
                'Do you wish to proceed?'
        }
        const promptChoice = await displayNotificationWithInput('Information', prompt, ['Proceed'])
        if (promptChoice !== 'Proceed') {
            return
        }

        const setDefaultToolchainResult = await elanSetDefaultToolchain(this.channel, selectedDefaultToolchain)
        switch (setDefaultToolchainResult.kind) {
            case 'Success':
                displayNotification(
                    'Information',
                    `Default Lean version '${selectedDefaultToolchain}' set successfully.`,
                )
                const clientForUntitledFiles = this.clientProvider?.findClient(new UntitledUri())
                await clientForUntitledFiles?.restart()
                break
            case 'ElanNotFound':
                displayNotification('Error', 'Cannot set Lean default version: Elan is not installed.')
                break
            case 'Error':
                displayNotification('Error', `Cannot set Lean default version: ${setDefaultToolchainResult.message}`)
                break
        }
    }

    async updateReleaseChannel() {
        if (!(await this.checkElanSupportsDumpState())) {
            return
        }

        const context = 'Update Release Channel Lean Version'
        const channels = [
            {
                name: 'Stable',
                identifier: elanStableChannel,
            },
            {
                name: 'Nightly',
                identifier: elanNightlyChannel,
            },
        ]

        const channelInfos: { name: string; info: ActiveToolchainInfo }[] = []
        for (const channel of channels) {
            const activeToolchainInfo = await this.activeToolchain(context, channel.identifier)
            if (activeToolchainInfo === undefined) {
                return
            }
            if (activeToolchainInfo.cachedToolchain === activeToolchainInfo.resolvedToolchain) {
                continue
            }
            channelInfos.push({
                name: channel.name,
                info: activeToolchainInfo,
            })
        }

        if (channelInfos.length === 0) {
            displayNotification('Information', 'All Lean versions for all release channels are up-to-date.')
            return
        }

        const items: (QuickPickItem & { info: ActiveToolchainInfo })[] = channelInfos.map(channelInfo => {
            const i = channelInfo.info
            let detail: string
            if (i.cachedToolchain === undefined) {
                detail = `Current: Not installed ⟹ New: ${toolchainVersion(i.resolvedToolchain)}`
            } else {
                detail = `Current: ${toolchainVersion(i.cachedToolchain)} ⟹ New: ${toolchainVersion(i.resolvedToolchain)}`
            }
            return {
                label: channelInfo.name,
                description: i.unresolvedToolchain,
                detail,
                info: i,
            }
        })

        const choice = await window.showQuickPick(items, {
            title: 'Select the Lean release channel that should be updated to the most recent version',
            matchOnDescription: true,
        })
        if (choice === undefined) {
            return
        }
        const channel = choice.info.unresolvedToolchain

        const installToolchainResult = await elanInstallToolchain(
            this.channel,
            'Update Release Channel Lean Version',
            channel,
        )
        if (installToolchainResult.kind === 'ElanNotFound') {
            displayNotification('Error', `Error while updating Lean version for '${channel}': Elan not found.`)
            return
        }
        if (installToolchainResult.kind === 'Error') {
            displayNotification(
                'Error',
                `Error while updating Lean version for '${channel}': ${installToolchainResult.message}`,
            )
            return
        }
        if (installToolchainResult.kind === 'Cancelled') {
            displayNotification('Information', 'Lean version update cancelled.')
            return
        }
        if (installToolchainResult.kind === 'ToolchainAlreadyInstalled') {
            displayNotification('Information', `Lean version for release channel '${channel}' is already up-to-date.`)
            return
        }
        installToolchainResult.kind satisfies 'Success'
        displayNotification(
            'Information',
            `Lean version for release channel '${channel}' has been updated to '${choice.info.resolvedToolchain}' successfully.`,
        )
    }

    async uninstallToolchains() {
        if (!(await this.checkElanSupportsDumpState())) {
            return
        }

        const queryGcResult = await elanQueryGc()
        if (queryGcResult.kind === 'ElanNotFound') {
            displayElanNotInstalledError()
            return
        }
        if (queryGcResult.kind === 'ExecutionError') {
            displayNotification('Error', `Error while querying unused toolchains: ${queryGcResult.message}`)
            return
        }
        const unusedToolchains = queryGcResult.info.unusedToolchains
        const unusedToolchainIndex = new Set(unusedToolchains)
        const usedToolchainIndex = groupByKey(queryGcResult.info.usedToolchains, u => u.toolchain)

        const toolchainInfo = await this.installedToolchains()
        if (toolchainInfo === undefined) {
            return
        }
        const installedToolchains = sortToolchains(toolchainInfo.toolchains)
        if (installedToolchains.length === 0) {
            displayNotification('Information', 'No Lean versions installed.')
            return
        }
        const installedToolchainItems = installedToolchains.map(t => {
            const users = usedToolchainIndex
                .get(t)
                ?.map(t => {
                    if (t.user === 'default toolchain') {
                        // Translate Elan nomenclature to vscode-lean4 nomenclature
                        return 'default Lean version'
                    }
                    return `'${t.user}'`
                })
                .join(', ')
            return {
                label: t,
                description: users !== undefined ? `(used by ${users})` : '(unused)',
            }
        })

        const allItems: QuickPickItem[] = []
        const uninstallUnusedLabel = 'Uninstall all unused Lean versions'
        if (unusedToolchains.length > 0) {
            allItems.push({
                label: uninstallUnusedLabel,
                detail: unusedToolchains.map(t => toolchainVersion(t)).join(', '),
            })
            allItems.push({
                label: '',
                kind: QuickPickItemKind.Separator,
            })
        }
        allItems.push(...installedToolchainItems)

        const choices = await window.showQuickPick(allItems, {
            canPickMany: true,
            title: 'Choose Lean versions to uninstall',
        })
        if (choices === undefined || choices.length === 0) {
            return
        }

        const toolchainsToUninstall: string[] = []
        if (choices.find(c => c.label === uninstallUnusedLabel) !== undefined) {
            toolchainsToUninstall.push(...unusedToolchains)
            toolchainsToUninstall.push(
                ...choices
                    .filter(c => c.label !== uninstallUnusedLabel && !unusedToolchainIndex.has(c.label))
                    .map(c => c.label),
            )
        } else {
            toolchainsToUninstall.push(...choices.map(c => c.label))
        }

        const formattedChoices =
            toolchainsToUninstall.length === 1
                ? `'${toolchainsToUninstall[0]}'`
                : toolchainsToUninstall.map(c => `'${c}'`).join(', ')
        const confirmationPromptChoice = await displayNotificationWithInput(
            'Information',
            `This command will uninstall ${formattedChoices}. Do you wish to proceed?`,
            ['Proceed'],
        )
        if (confirmationPromptChoice === undefined) {
            return
        }
        confirmationPromptChoice satisfies 'Proceed'

        const r = await elanUninstallToolchains(this.channel, 'Uninstall Lean Versions', toolchainsToUninstall)
        switch (r.exitCode) {
            case ExecutionExitCode.Success:
                const name = toolchainsToUninstall.length === 1 ? 'Lean version' : 'Lean versions'
                displayNotification('Information', `${name} ${formattedChoices} uninstalled successfully.`)
                return
            case ExecutionExitCode.CannotLaunch:
                displayElanNotInstalledError()
                return
            case ExecutionExitCode.ExecutionError:
                displayNotification('Error', `Error while uninstalling Lean versions: ${r.combined}`)
                return
            case ExecutionExitCode.Cancelled:
                return
        }
    }

    async selectProjectToolchain() {
        if (!(await this.checkElanSupportsDumpState())) {
            return
        }

        const selectProjectToolchainContext = 'Select Project Lean Version'

        const activeClient = this.clientProvider?.getActiveClient()
        if (activeClient === undefined) {
            displayNotification(
                'Error',
                'No active client. Please focus a Lean file of the project for which you want to select a Lean version.',
            )
            return
        }
        const activeClientUri = activeClient.getClientFolder()
        const leanToolchainPath = (clientUri: FileUri) => clientUri.join('lean-toolchain').fsPath

        if (activeClientUri.scheme === 'untitled' || !(await fileExists(leanToolchainPath(activeClientUri)))) {
            displayNotification(
                'Error',
                'Focused file is not contained in a Lean project. Please focus a Lean file of the project for which you want to select a Lean version.',
            )
            return
        }

        const selectedProjectToolchain = await this.displayToolchainSelectionQuickPick(
            selectProjectToolchainContext,
            'Select project Lean version',
            false,
        )
        if (selectedProjectToolchain === undefined) {
            return
        }

        const prompt =
            `This operation will set '${selectedProjectToolchain}' to be the Lean version of the Lean project at '${activeClientUri.fsPath}'. It is only intended to be used by maintainers of this project.\n\n` +
            'Changing the Lean version of this project may lead to breakages induced by incompatibilities with the new Lean version. For example, the following components of this project may end up being incompatible with the new Lean version:\n' +
            '- The Lean code in this project\n' +
            "- The 'lakefile.toml' or 'lakefile.lean' configuring this project\n" +
            '- Lake dependencies of this project\n\n' +
            "If you simply want to update a Lake dependency of this project and use its Lean version to ensure that the Lean version of the dependency is compatible with the Lean version of this project, it is preferable to use the 'Project: Update Dependency' command instead of this one.\n\n" +
            'Do you wish to proceed?'
        const choice = await displayNotificationWithInput('Information', prompt, ['Proceed'])
        if (choice !== 'Proceed') {
            return
        }

        try {
            await promises.writeFile(leanToolchainPath(activeClientUri), selectedProjectToolchain, {
                encoding: 'utf8',
                flush: true,
            })
        } catch (e) {
            if (e instanceof Error) {
                displayNotification('Error', `Update of '${leanToolchainPath(activeClientUri)}' failed: ${e.message}`)
            } else {
                displayNotification('Error', `Update of '${leanToolchainPath(activeClientUri)}' failed.`)
            }
            return
        }

        await activeClient.restart()

        displayNotification('Information', 'Project Lean version update successful.')
    }

    private async displayToolchainSelectionQuickPick(
        context: string,
        title: string,
        includeStable: boolean,
    ): Promise<string | undefined> {
        const toolchainInfo = await this.installedToolchains()
        if (toolchainInfo === undefined) {
            return undefined
        }
        const installedToolchains = sortToolchains(toolchainInfo.toolchains)
        const installedToolchainIndex = new Set(installedToolchains)

        let stableToolchains: string[] = []
        let betaToolchains: string[] = []
        let nightlyToolchains: string[] = []
        const leanReleasesQueryResult = await queryLeanReleases(context)
        if (leanReleasesQueryResult.kind === 'CannotParse') {
            displayNotification(
                'Warning',
                "Could not fetch Lean versions: Cannot parse response from 'https://release.lean-lang.org/'.",
            )
        }
        if (leanReleasesQueryResult.kind === 'CannotFetch') {
            displayNotification('Warning', `Could not fetch Lean versions: ${leanReleasesQueryResult.error}`)
        }
        const toToolchainNames = (channel: LeanReleaseChannel) =>
            channel.map(t => `leanprover/lean4:${t.name}`).filter(t => !installedToolchainIndex.has(t))
        if (leanReleasesQueryResult.kind === 'Success') {
            stableToolchains = toToolchainNames(leanReleasesQueryResult.releases.stable)
            betaToolchains = toToolchainNames(leanReleasesQueryResult.releases.beta)
            nightlyToolchains = toToolchainNames(leanReleasesQueryResult.releases.nightly)
        }
        const downloadableToolchains = [stableToolchains, betaToolchains, nightlyToolchains]

        const stableItem: QuickPickItem = {
            label: 'Always use most recent stable version',
            description: elanStableChannel,
            picked: true,
        }
        const installedToolchainSeparator: QuickPickItem = { label: '', kind: QuickPickItemKind.Separator }
        const installedToolchainItems: QuickPickItem[] = installedToolchains.map(t => ({
            label: t,
            description: '(installed)',
        }))
        const downloadableToolchainItems: QuickPickItem[] = []
        for (const downloadableToolchainGroup of downloadableToolchains) {
            if (downloadableToolchainGroup.length === 0) {
                continue
            }
            const downloadableToolchainGroupSeparator: QuickPickItem = { label: '', kind: QuickPickItemKind.Separator }
            downloadableToolchainItems.push(downloadableToolchainGroupSeparator)
            for (const downloadableToolchain of downloadableToolchainGroup) {
                downloadableToolchainItems.push({
                    label: downloadableToolchain,
                    description: '(not installed)',
                })
            }
        }

        const allItems: QuickPickItem[] = []
        if (includeStable) {
            allItems.push(stableItem)
            allItems.push(installedToolchainSeparator)
        }
        allItems.push(...installedToolchainItems)
        allItems.push(...downloadableToolchainItems)

        const choice = await window.showQuickPick(allItems, {
            matchOnDescription: true,
            title,
        })
        if (choice === undefined) {
            return undefined
        }
        if (choice.description === elanStableChannel) {
            return elanStableChannel
        } else {
            return choice.label
        }
    }

    private async activeToolchain(
        context: string,
        toolchain?: string | undefined,
    ): Promise<ActiveToolchainInfo | undefined> {
        const r = await elanActiveToolchain(undefined, context, toolchain)
        if (r.kind === 'ExecutionError') {
            displayNotification('Error', `Error while obtaining Lean versions: ${r.message}`)
            return undefined
        }
        if (r.kind === 'ElanNotFound') {
            displayElanNotInstalledError()
            return undefined
        }
        if (r.kind === 'Cancelled') {
            return undefined
        }
        if (r.kind === 'NoActiveToolchain') {
            if (toolchain === undefined) {
                displayNotification('Error', 'No active Lean version.')
            } else {
                displayNotification(
                    'Error',
                    `Error while obtaining Lean versions: Expected active Lean version for toolchain override with '${toolchain}'`,
                )
            }
            return undefined
        }
        r.kind satisfies 'Success'
        return r.info
    }

    private async installedToolchains(): Promise<
        { defaultToolchain: string | undefined; toolchains: string[] } | undefined
    > {
        const r = await elanInstalledToolchains()
        if (r.kind === 'ExecutionError') {
            displayNotification('Error', `Error while obtaining Lean versions:  ${r.message}`)
            return undefined
        }
        if (r.kind === 'ElanNotFound') {
            displayElanNotInstalledError()
            return undefined
        }
        r.kind satisfies 'Success'
        return {
            defaultToolchain: r.defaultToolchain,
            toolchains: r.toolchains,
        }
    }

    private async checkElanSupportsDumpState(): Promise<boolean> {
        const r = await elanVersion()
        switch (r.kind) {
            case 'Success':
                if (!isElanEagerResolutionVersion(r.version)) {
                    displayNotification(
                        'Error',
                        `This command can only be used with Elan versions >= ${elanEagerResolutionMajorVersion}.0.0, but the installed Elan version is ${r.version.toString()}.`,
                    )
                    return false
                }
                return true
            case 'ElanNotInstalled':
                displayElanNotInstalledError()
                return false
            case 'ExecutionError':
                displayNotification('Error', `Error while checking Elan version: ${r.message}`)
                return false
        }
    }

    dispose() {
        for (const subscription of this.subscriptions) {
            subscription.dispose()
        }
    }
}
