import { SemVer } from 'semver'
import { Disposable } from 'vscode'
import { shouldShowSetupWarnings } from '../config'
import { LeanInstaller, UpdateElanMode } from '../utils/leanInstaller'
import {
    displayModalNotification,
    displayModalNotificationWithOutput,
    displayModalNotificationWithSetupGuide,
    displayNotification,
    displayNotificationWithInput,
    displayNotificationWithOptionalInput,
    displayNotificationWithOutput,
    displayNotificationWithSetupGuide,
    displayStickyNotificationWithOptionalInput,
    displayStickyNotificationWithOutput,
    displayStickyNotificationWithSetupGuide,
    Input,
    StickyInput,
    StickyNotificationOptions,
} from '../utils/notifs'

export type PreconditionCheckResult = 'Fulfilled' | 'Warning' | 'Fatal'

export function preconditionCheckResultToSeverity(result: PreconditionCheckResult): 0 | 1 | 2 {
    switch (result) {
        case 'Fulfilled':
            return 0
        case 'Warning':
            return 1
        case 'Fatal':
            return 2
    }
}

export function severityToPreconditionCheckResult(severity: 0 | 1 | 2): PreconditionCheckResult {
    switch (severity) {
        case 0:
            return 'Fulfilled'
        case 1:
            return 'Warning'
        case 2:
            return 'Fatal'
    }
}

export function worstPreconditionViolation(...results: PreconditionCheckResult[]): PreconditionCheckResult {
    let worstViolation: PreconditionCheckResult = 'Fulfilled'
    for (const r of results) {
        if (preconditionCheckResultToSeverity(r) > preconditionCheckResultToSeverity(worstViolation)) {
            worstViolation = r
        }
    }
    return worstViolation
}

export type SetupNotificationOptions = {
    errorMode: { mode: 'Sticky'; retry: () => Promise<void> } | { mode: 'Modal' } | { mode: 'NonModal' }
    warningMode: { modal: boolean; proceedByDefault: boolean }
}

const closeItem: string = 'Close'
const proceedItem: string = 'Proceed'
const proceedRegardlessItem: string = 'Proceed Regardless'
const retryItem: StickyInput<string> = {
    input: 'Retry',
    continueDisplaying: false,
    action: async () => {},
}

export class SetupNotifier {
    private subscriptions: Disposable[] = []

    constructor(private options: SetupNotificationOptions) {}

    private async error(notifs: {
        modal: () => Promise<PreconditionCheckResult>
        nonModal?: () => PreconditionCheckResult
        sticky: (options: StickyNotificationOptions<string>) => Promise<Disposable>
    }): Promise<PreconditionCheckResult> {
        const m = this.options.errorMode
        if (m.mode === 'Modal') {
            return await notifs.modal()
        }
        if (m.mode === 'NonModal') {
            if (notifs.nonModal === undefined) {
                return await notifs.modal()
            }
            return notifs.nonModal()
        }

        const r = await notifs.modal()
        if (r !== 'Fatal') {
            return r
        }
        const options: StickyNotificationOptions<string> = {
            onInput: async (_, continueDisplaying) => {
                if (!continueDisplaying) {
                    await m.retry()
                }
                return continueDisplaying
            },
            onDisplay: async () => {},
        }
        const d = await notifs.sticky(options)
        this.subscriptions.push(d)
        return 'Fatal'
    }

    private async warning(notifs: {
        modalAskBeforeProceeding: () => Promise<PreconditionCheckResult>
        modalProceedByDefault: () => Promise<PreconditionCheckResult>
        nonModal?: () => PreconditionCheckResult
    }) {
        if (!shouldShowSetupWarnings()) {
            return 'Warning'
        }
        if (this.options.warningMode.modal || notifs.nonModal === undefined) {
            if (this.options.warningMode.proceedByDefault) {
                return await notifs.modalProceedByDefault()
            } else {
                return await notifs.modalAskBeforeProceeding()
            }
        } else {
            return notifs.nonModal()
        }
    }

    async displaySetupError(message: string): Promise<PreconditionCheckResult> {
        return await this.error({
            modal: async () => {
                await displayModalNotification('Error', message)
                return 'Fatal'
            },
            nonModal: () => {
                displayNotification('Error', message)
                return 'Fatal'
            },
            sticky: async options => displayStickyNotificationWithOptionalInput('Error', message, options, [retryItem]),
        })
    }

    async displaySetupWarning(message: string): Promise<PreconditionCheckResult> {
        return await this.warning({
            modalProceedByDefault: async () => {
                await displayModalNotification('Warning', message)
                return 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const choice = await displayNotificationWithInput('Warning', message, [proceedRegardlessItem])
                return choice === proceedRegardlessItem ? 'Warning' : 'Fatal'
            },
            nonModal: () => {
                displayNotification('Warning', message)
                return 'Warning'
            },
        })
    }

    async displaySetupErrorWithInput(message: string, inputs: StickyInput<string>[]): Promise<PreconditionCheckResult> {
        return await this.error({
            modal: async () => {
                const choice = await displayNotificationWithInput(
                    'Error',
                    message,
                    inputs.map(i => i.input),
                )
                const chosenInput = inputs.find(i => i.input === choice)
                await chosenInput?.action()
                return 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithOptionalInput('Error', message, inputs)
                return 'Fatal'
            },
            sticky: async options =>
                displayStickyNotificationWithOptionalInput('Error', message, options, [retryItem, ...inputs]),
        })
    }

    async displaySetupWarningWithInput(message: string, inputs: Input<string>[]): Promise<PreconditionCheckResult> {
        return await this.warning({
            modalProceedByDefault: async () => {
                const choice = await displayNotificationWithInput(
                    'Warning',
                    message,
                    inputs.map(i => i.input),
                    proceedItem,
                )
                const chosenInput = inputs.find(i => i.input === choice)
                chosenInput?.action()
                return 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const choice = await displayNotificationWithInput('Warning', message, [
                    ...inputs.map(i => i.input),
                    proceedRegardlessItem,
                ])
                const chosenInput = inputs.find(i => i.input === choice)
                chosenInput?.action()
                return choice === proceedRegardlessItem ? 'Warning' : 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithOptionalInput('Warning', message, inputs)
                return 'Warning'
            },
        })
    }

    async displaySetupErrorWithOutput(message: string): Promise<PreconditionCheckResult> {
        return await this.error({
            modal: async () => {
                await displayModalNotificationWithOutput('Error', message, [], closeItem)
                return 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithOutput('Error', message)
                return 'Fatal'
            },
            sticky: async options => displayStickyNotificationWithOutput('Error', message, options, [retryItem]),
        })
    }

    async displaySetupWarningWithOutput(message: string): Promise<PreconditionCheckResult> {
        return await this.warning({
            modalProceedByDefault: async () => {
                await displayModalNotificationWithOutput('Warning', message, [], proceedItem)
                return 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const choice = await displayModalNotificationWithOutput('Warning', message, [proceedRegardlessItem])
                return choice === proceedRegardlessItem ? 'Warning' : 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithOutput('Warning', message)
                return 'Warning'
            },
        })
    }

    async displaySetupErrorWithSetupGuide(message: string): Promise<PreconditionCheckResult> {
        return await this.error({
            modal: async () => {
                await displayModalNotificationWithSetupGuide('Error', message, [], closeItem)
                return 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithSetupGuide('Error', message)
                return 'Fatal'
            },
            sticky: async options => displayStickyNotificationWithSetupGuide('Error', message, options, [retryItem]),
        })
    }

    async displaySetupWarningWithSetupGuide(message: string): Promise<PreconditionCheckResult> {
        return await this.warning({
            modalProceedByDefault: async () => {
                await displayModalNotificationWithSetupGuide('Warning', message, [], proceedItem)
                return 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const choice = await displayModalNotificationWithSetupGuide('Warning', message, [proceedRegardlessItem])
                return choice === proceedRegardlessItem ? 'Warning' : 'Fatal'
            },
            nonModal: () => {
                displayNotificationWithSetupGuide('Warning', message)
                return 'Warning'
            },
        })
    }

    async displayElanSetupError(installer: LeanInstaller, reason: string): Promise<PreconditionCheckResult> {
        return await this.error({
            modal: async () => {
                const isElanInstalled = await installer.displayInstallElanPrompt('Error', reason)
                return isElanInstalled ? 'Fulfilled' : 'Fatal'
            },
            sticky: async options => installer.displayStickyInstallElanPrompt('Error', reason, options, [retryItem]),
        })
    }

    async displayElanSetupWarning(installer: LeanInstaller, reason: string): Promise<PreconditionCheckResult> {
        return await this.warning({
            modalProceedByDefault: async () => {
                const r = await installer.displayInstallElanPromptWithItems('Warning', reason, [], proceedItem)
                const success = r !== undefined && r.kind === 'InstallElan' && r.success
                return success ? 'Fulfilled' : 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const r = await installer.displayInstallElanPromptWithItems('Warning', reason, [proceedRegardlessItem])
                if (r === undefined) {
                    return 'Fatal'
                }
                if (r.kind === 'InstallElan') {
                    return r.success ? 'Fulfilled' : 'Warning'
                }
                return 'Warning'
            },
        })
    }

    async displayElanOutdatedSetupError(
        installer: LeanInstaller,
        currentVersion: SemVer,
        recommendedVersion: SemVer,
    ): Promise<PreconditionCheckResult> {
        const mode: UpdateElanMode = {
            kind: 'Outdated',
            versions: { currentVersion, recommendedVersion },
        }
        return await this.error({
            modal: async () => {
                const isElanUpToDate = await installer.displayUpdateElanPrompt('Error', mode)
                return isElanUpToDate ? 'Fulfilled' : 'Fatal'
            },
            sticky: async options => installer.displayStickyUpdateElanPrompt('Error', mode, options, [retryItem]),
        })
    }

    async displayElanOutdatedSetupWarning(
        installer: LeanInstaller,
        currentVersion: SemVer,
        recommendedVersion: SemVer,
    ): Promise<PreconditionCheckResult> {
        const mode: UpdateElanMode = {
            kind: 'Outdated',
            versions: { currentVersion, recommendedVersion },
        }
        return await this.warning({
            modalProceedByDefault: async () => {
                const r = await installer.displayUpdateElanPromptWithItems('Warning', mode, [], proceedItem)
                const success = r !== undefined && r.kind === 'UpdateElan' && r.success
                return success ? 'Fulfilled' : 'Warning'
            },
            modalAskBeforeProceeding: async () => {
                const r = await installer.displayUpdateElanPromptWithItems('Warning', mode, [proceedRegardlessItem])
                if (r === undefined) {
                    return 'Fatal'
                }
                if (r.kind === 'UpdateElan') {
                    return r.success ? 'Fulfilled' : 'Warning'
                }
                return 'Warning'
            },
        })
    }
}
