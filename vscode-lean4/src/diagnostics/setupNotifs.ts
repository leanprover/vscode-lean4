import { SemVer } from 'semver'
import { shouldShowSetupWarnings } from '../config'
import { LeanInstaller } from '../utils/leanInstaller'
import {
    displayError,
    displayErrorWithInput,
    displayErrorWithOptionalInput,
    displayErrorWithOutput,
    displayErrorWithSetupGuide,
    displayModalWarning,
    displayModalWarningWithOutput,
    displayModalWarningWithSetupGuide,
    displayWarning,
    displayWarningWithInput,
    displayWarningWithOptionalInput,
    displayWarningWithOutput,
    displayWarningWithSetupGuide,
} from '../utils/notifs'

export enum PreconditionCheckResult {
    Fulfilled = 0,
    Warning = 1,
    Fatal = 2,
}

export function worstPreconditionViolation(...results: PreconditionCheckResult[]): PreconditionCheckResult {
    return Math.max(...results)
}

export type SetupWarningOptions = { modal: true } | { modal: false; finalizer?: (() => void) | undefined }

export function displaySetupError(message: string, finalizer?: (() => void) | undefined): PreconditionCheckResult {
    displayError(message, finalizer)
    return PreconditionCheckResult.Fatal
}

export async function displaySetupErrorWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await displayErrorWithInput(message, ...items)
}

export function displaySetupErrorWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    displayErrorWithOptionalInput(message, input, action, finalizer)
    return PreconditionCheckResult.Fatal
}

export function displaySetupErrorWithOutput(
    message: string,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    displayErrorWithOutput(message, finalizer)
    return PreconditionCheckResult.Fatal
}

export function displaySetupErrorWithSetupGuide(
    message: string,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    displayErrorWithSetupGuide(message, finalizer)
    return PreconditionCheckResult.Fatal
}

export function displayDependencySetupError(missingDeps: string[]): PreconditionCheckResult {
    if (missingDeps.length === 0) {
        throw new Error()
    }
    let missingDepMessage: string
    if (missingDeps.length === 1) {
        missingDepMessage = `One of Lean's dependencies ('${missingDeps.at(0)}') is missing`
    } else {
        missingDepMessage = `Multiple of Lean's dependencies (${missingDeps.map(dep => `'${dep}'`).join(', ')}) are missing`
    }

    const errorMessage = `${missingDepMessage}. Please read the Setup Guide on how to install missing dependencies and set up Lean 4.`
    displaySetupErrorWithSetupGuide(errorMessage)
    return PreconditionCheckResult.Fatal
}

export async function displayElanSetupError(
    installer: LeanInstaller,
    reason: string,
): Promise<PreconditionCheckResult> {
    const isElanInstalled = await installer.displayInstallElanPrompt(reason, 'Error')
    return isElanInstalled ? PreconditionCheckResult.Fulfilled : PreconditionCheckResult.Fatal
}

export async function displayElanOutdatedSetupError(
    installer: LeanInstaller,
    currentVersion: SemVer,
    recommendedVersion: SemVer,
): Promise<PreconditionCheckResult> {
    const isElanUpToDate = await installer.displayUpdateElanPrompt(currentVersion, recommendedVersion, 'Error')
    return isElanUpToDate ? PreconditionCheckResult.Fulfilled : PreconditionCheckResult.Fatal
}

export async function displaySetupWarning(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    if (options.modal) {
        const choice = await displayModalWarning(message)
        return choice === 'Proceed' ? PreconditionCheckResult.Warning : PreconditionCheckResult.Fatal
    }
    displayWarning(message, options.finalizer)
    return PreconditionCheckResult.Warning
}

export async function displaySetupWarningWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    if (!shouldShowSetupWarnings()) {
        return undefined
    }
    return await displayWarningWithInput(message, ...items)
}

export function displaySetupWarningWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    displayWarningWithOptionalInput(message, input, action, finalizer)
    return PreconditionCheckResult.Warning
}

export async function displaySetupWarningWithOutput(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    if (options.modal) {
        const choice = await displayModalWarningWithOutput(message)
        return choice === 'Proceed' ? PreconditionCheckResult.Warning : PreconditionCheckResult.Fatal
    }
    displayWarningWithOutput(message, options.finalizer)
    return PreconditionCheckResult.Warning
}

export async function displaySetupWarningWithSetupGuide(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    if (options.modal) {
        const choice = await displayModalWarningWithSetupGuide(message)
        return choice === 'Proceed' ? PreconditionCheckResult.Warning : PreconditionCheckResult.Fatal
    }
    displayWarningWithSetupGuide(message, options.finalizer)
    return PreconditionCheckResult.Warning
}

export async function displayElanSetupWarning(
    installer: LeanInstaller,
    reason: string,
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    const isElanInstalled = await installer.displayInstallElanPrompt(reason, 'Warning')
    return isElanInstalled ? PreconditionCheckResult.Fulfilled : PreconditionCheckResult.Warning
}

export async function displayElanOutdatedSetupWarning(
    installer: LeanInstaller,
    currentVersion: SemVer,
    recommendedVersion: SemVer,
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return PreconditionCheckResult.Warning
    }
    const isElanUpToDate = await installer.displayUpdateElanPrompt(currentVersion, recommendedVersion, 'Warning')
    return isElanUpToDate ? PreconditionCheckResult.Fulfilled : PreconditionCheckResult.Warning
}
