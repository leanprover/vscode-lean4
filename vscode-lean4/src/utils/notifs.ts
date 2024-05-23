import { MessageOptions, commands, window } from 'vscode'

// All calls to window.show(Error|Warning|Information)... should go through functions in this file
// to prevent accidentally blocking the VS Code extension.
// Specifically, we want to enforce the following invariants:
// - Notifications without input should never block the extension
// - Notifications with optional input should never block the extension
// - Notifications that block the extension must be modal

export type NotificationSeverity = 'Information' | 'Warning' | 'Error'

type Notification = <T extends string>(
    message: string,
    options: MessageOptions,
    ...items: T[]
) => Thenable<T | undefined>

function toNotif(severity: NotificationSeverity): Notification {
    switch (severity) {
        case 'Information':
            return window.showInformationMessage
        case 'Warning':
            return window.showWarningMessage
        case 'Error':
            return window.showErrorMessage
    }
}

export function displayNotification(
    severity: NotificationSeverity,
    message: string,
    finalizer?: (() => void) | undefined,
) {
    void (async () => {
        await toNotif(severity)(message, {})
        if (finalizer) {
            finalizer()
        }
    })()
}

export async function displayNotificationWithInput<T extends string>(
    severity: NotificationSeverity,
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await toNotif(severity)(message, { modal: true }, ...items)
}

export function displayNotificationWithOptionalInput<T extends string>(
    severity: NotificationSeverity,
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    void (async () => {
        const choice = await toNotif(severity)(message, {}, input)
        if (choice === input) {
            action()
        }
        if (finalizer) {
            finalizer()
        }
    })()
}

export function displayNotificationWithOutput(
    severity: NotificationSeverity,
    message: string,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput(
        severity,
        message,
        'Show Output',
        () => commands.executeCommand('lean4.troubleshooting.showOutput'),
        finalizer,
    )
}

export function displayNotificationWithSetupGuide(
    severity: NotificationSeverity,
    message: string,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput(
        severity,
        message,
        'Open Setup Guide',
        () => commands.executeCommand('lean4.setup.showSetupGuide'),
        finalizer,
    )
}

export function displayError(message: string, finalizer?: (() => void) | undefined) {
    displayNotification('Error', message, finalizer)
}

export async function displayErrorWithInput<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return await displayNotificationWithInput('Error', message, ...items)
}

export function displayErrorWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput('Error', message, input, action, finalizer)
}

export function displayErrorWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput('Error', message, finalizer)
}

export function displayErrorWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide('Error', message, finalizer)
}

export function displayWarning(message: string, finalizer?: (() => void) | undefined) {
    displayNotification('Warning', message, finalizer)
}

export async function displayModalWarning(message: string): Promise<'Proceed' | 'Abort'> {
    const choice = await window.showWarningMessage(message, { modal: true }, 'Proceed Regardless')
    return choice === 'Proceed Regardless' ? 'Proceed' : 'Abort'
}

export async function displayWarningWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await displayNotificationWithInput('Warning', message, ...items)
}

export function displayWarningWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput('Warning', message, input, action, finalizer)
}

export function displayWarningWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput('Warning', message, finalizer)
}

export async function displayModalWarningWithOutput(message: string): Promise<'Proceed' | 'Abort'> {
    const choice = await window.showWarningMessage(message, 'Show Output', 'Proceed Regardless')
    if (choice === undefined) {
        return 'Abort'
    }
    if (choice === 'Proceed Regardless') {
        return 'Proceed'
    }
    await commands.executeCommand('lean4.troubleshooting.showOutput')
    return 'Abort'
}

export function displayWarningWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide('Warning', message, finalizer)
}

export async function displayModalWarningWithSetupGuide(message: string): Promise<'Proceed' | 'Abort'> {
    const choice = await window.showWarningMessage(message, 'Open Setup Guide', 'Proceed Regardless')
    if (choice === undefined) {
        return 'Abort'
    }
    if (choice === 'Proceed Regardless') {
        return 'Proceed'
    }
    await commands.executeCommand('lean4.setup.showSetupGuide')
    return 'Abort'
}

export function displayInformation(message: string, finalizer?: (() => void) | undefined) {
    displayNotification('Information', message, finalizer)
}

export async function displayInformationWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await displayNotificationWithInput('Information', message, ...items)
}

export function displayInformationWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput('Information', message, input, action, finalizer)
}

export function displayInformationWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput('Information', message, finalizer)
}

export function displayInformationWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide('Information', message, finalizer)
}
