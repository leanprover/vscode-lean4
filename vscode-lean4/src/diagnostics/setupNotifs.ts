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

export type SetupWarningOptions = { modal: true } | { modal: false; finalizer?: (() => void) | undefined }

export function displaySetupError(message: string, finalizer?: (() => void) | undefined): PreconditionCheckResult {
    displayError(message, finalizer)
    return 'Fatal'
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
    return 'Fatal'
}

export function displaySetupErrorWithOutput(
    message: string,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    displayErrorWithOutput(message, finalizer)
    return 'Fatal'
}

export function displaySetupErrorWithSetupGuide(
    message: string,
    finalizer?: (() => void) | undefined,
): PreconditionCheckResult {
    displayErrorWithSetupGuide(message, finalizer)
    return 'Fatal'
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
    return 'Fatal'
}

export async function displayElanSetupError(
    installer: LeanInstaller,
    reason: string,
): Promise<PreconditionCheckResult> {
    const isElanInstalled = await installer.displayInstallElanPrompt('Error', reason)
    return isElanInstalled ? 'Fulfilled' : 'Fatal'
}

export async function displayElanOutdatedSetupError(
    installer: LeanInstaller,
    currentVersion: SemVer,
    recommendedVersion: SemVer,
): Promise<PreconditionCheckResult> {
    const isElanUpToDate = await installer.displayUpdateElanPrompt('Error', currentVersion, recommendedVersion)
    return isElanUpToDate ? 'Fulfilled' : 'Fatal'
}

export async function displaySetupWarning(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return 'Warning'
    }
    if (options.modal == true) {
        const choice = await displayModalWarning(message)
        return choice === 'Proceed' ? 'Warning' : 'Fatal'
    }
    displayWarning(message, options.finalizer)
    return 'Warning'
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
        return 'Warning'
    }
    displayWarningWithOptionalInput(message, input, action, finalizer)
    return 'Warning'
}

export async function displaySetupWarningWithOutput(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return 'Warning'
    }
    if (options.modal == true) {
        const choice = await displayModalWarningWithOutput(message)
        return choice === 'Proceed' ? 'Warning' : 'Fatal'
    }
    displayWarningWithOutput(message, options.finalizer)
    return 'Warning'
}

export async function displaySetupWarningWithSetupGuide(
    message: string,
    options: SetupWarningOptions = { modal: false },
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return 'Warning'
    }
    if (options.modal == true) {
        const choice = await displayModalWarningWithSetupGuide(message)
        return choice === 'Proceed' ? 'Warning' : 'Fatal'
    }
    displayWarningWithSetupGuide(message, options.finalizer)
    return 'Warning'
}

export async function displayElanSetupWarning(
    installer: LeanInstaller,
    reason: string,
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return 'Warning'
    }
    const isElanInstalled = await installer.displayInstallElanPrompt('Warning', reason)
    return isElanInstalled ? 'Fulfilled' : 'Warning'
}

export async function displayElanOutdatedSetupWarning(
    installer: LeanInstaller,
    currentVersion: SemVer,
    recommendedVersion: SemVer,
): Promise<PreconditionCheckResult> {
    if (!shouldShowSetupWarnings()) {
        return 'Warning'
    }
    const isElanUpToDate = await installer.displayUpdateElanPrompt('Warning', currentVersion, recommendedVersion)
    return isElanUpToDate ? 'Fulfilled' : 'Warning'
}
