import { MessageOptions, commands, window } from 'vscode'

// All calls to window.show(Error|Warning|Information)... should go through functions in this file
// to prevent accidentally blocking the VS Code extension.
// Specifically, we want to enforce the following invariants:
// - Notifications without input should never block the extensions
// - Notifications with optional input should never block the extension
// - Notifications that block the extension must be modal

type Notification = <T extends string>(
    message: string,
    options: MessageOptions,
    ...items: T[]
) => Thenable<T | undefined>

function displayNotification(notif: Notification, message: string, finalizer?: (() => void) | undefined) {
    void (async () => {
        await notif(message, {})
        if (finalizer) {
            finalizer()
        }
    })()
}

async function displayNotificationWithInput<T extends string>(
    notif: Notification,
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await notif(message, { modal: true }, ...items)
}

function displayNotificationWithOptionalInput<T extends string>(
    notif: Notification,
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    void (async () => {
        const choice = await notif(message, {}, input)
        if (choice === input) {
            action()
        }
        if (finalizer) {
            finalizer()
        }
    })()
}

function displayNotificationWithOutput(notif: Notification, message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOptionalInput(
        notif,
        message,
        'Show Output',
        () => commands.executeCommand('lean4.troubleshooting.showOutput'),
        finalizer,
    )
}

function displayNotificationWithSetupGuide(notif: Notification, message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOptionalInput(
        notif,
        message,
        'Open Setup Guide',
        () => commands.executeCommand('lean4.setup.showSetupGuide'),
        finalizer,
    )
}

export function displayError(message: string, finalizer?: (() => void) | undefined) {
    displayNotification(window.showErrorMessage, message, finalizer)
}

export async function displayErrorWithInput<T extends string>(message: string, ...items: T[]): Promise<T | undefined> {
    return await displayNotificationWithInput(window.showErrorMessage, message, ...items)
}

export function displayErrorWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput(window.showErrorMessage, message, input, action, finalizer)
}

export function displayErrorWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput(window.showErrorMessage, message, finalizer)
}

export function displayErrorWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide(window.showErrorMessage, message, finalizer)
}

export function displayWarning(message: string, finalizer?: (() => void) | undefined) {
    displayNotification(window.showWarningMessage, message, finalizer)
}

export async function displayWarningWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await displayNotificationWithInput(window.showWarningMessage, message, ...items)
}

export function displayWarningWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput(window.showWarningMessage, message, input, action, finalizer)
}

export function displayWarningWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput(window.showWarningMessage, message, finalizer)
}

export function displayWarningWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide(window.showWarningMessage, message, finalizer)
}

export function displayInformation(message: string, finalizer?: (() => void) | undefined) {
    displayNotification(window.showInformationMessage, message, finalizer)
}

export async function displayInformationWithInput<T extends string>(
    message: string,
    ...items: T[]
): Promise<T | undefined> {
    return await displayNotificationWithInput(window.showInformationMessage, message, ...items)
}

export function displayInformationWithOptionalInput<T extends string>(
    message: string,
    input: T,
    action: () => void,
    finalizer?: (() => void) | undefined,
) {
    displayNotificationWithOptionalInput(window.showInformationMessage, message, input, action, finalizer)
}

export function displayInformationWithOutput(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithOutput(window.showInformationMessage, message, finalizer)
}

export function displayInformationWithSetupGuide(message: string, finalizer?: (() => void) | undefined) {
    displayNotificationWithSetupGuide(window.showInformationMessage, message, finalizer)
}
