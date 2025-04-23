import { ConfigurationTarget, ThemeColor, workspace } from 'vscode'
import { elanStableChannel } from './utils/elan'
import { PATH } from './utils/envPath'

function processConfigColor(c: string): ThemeColor | string {
    if (c.match(/^(#|rgb\(|rgba\(|hsl\(|hsla\()/)) {
        return c
    }
    return new ThemeColor(c)
}

export function getPowerShellPath(): string {
    const windir = process.env.windir
    return `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

export function automaticallyBuildDependencies(): boolean {
    return workspace.getConfiguration('lean4').get('automaticallyBuildDependencies', false)
}

export function envPathExtensions(): PATH {
    return new PATH(workspace.getConfiguration('lean4').get('envPathExtensions', []))
}

export function alwaysAskBeforeInstallingLeanVersions(): boolean {
    return workspace.getConfiguration('lean4').get('alwaysAskBeforeInstallingLeanVersions', false)
}

export async function setAlwaysAskBeforeInstallingLeanVersions(alwaysAskBeforeInstallingLeanVersions: boolean) {
    await workspace
        .getConfiguration('lean4')
        .update(
            'alwaysAskBeforeInstallingLeanVersions',
            alwaysAskBeforeInstallingLeanVersions,
            ConfigurationTarget.Global,
        )
}

export function serverArgs(): string[] {
    return workspace.getConfiguration('lean4').get('serverArgs', [])
}

export function serverLoggingEnabled(): boolean {
    return workspace.getConfiguration('lean4.serverLogging').get('enabled', false)
}

export function serverLoggingPath(): string {
    return workspace.getConfiguration('lean4.serverLogging').get('path', '.')
}

export function shouldAutofocusOutput(): boolean {
    return workspace.getConfiguration('lean4').get('autofocusOutput', false)
}

export function getInfoViewStyle(): string {
    const val = workspace.getConfiguration('lean4.infoview').get<string>('style')
    if (val !== undefined) return val
    // Try deprecated name of the same setting if not found
    return workspace.getConfiguration('lean4').get('infoViewStyle', '')
}

export function getInfoViewAutoOpen(): boolean {
    const val = workspace.getConfiguration('lean4.infoview').get<boolean>('autoOpen')
    if (val !== undefined) return val
    return workspace.getConfiguration('lean4').get('infoViewAutoOpen', true)
}

export function getInfoViewAutoOpenShowsGoal(): boolean {
    const val = workspace.getConfiguration('lean4.infoview').get<boolean>('autoOpenShowsGoal')
    if (val !== undefined) return val
    return workspace.getConfiguration('lean4').get('infoViewAutoOpenShowGoal', true)
}

export function getInfoViewAllErrorsOnLine(): boolean {
    const val = workspace.getConfiguration('lean4.infoview').get<boolean>('allErrorsOnLine')
    if (val !== undefined) return val
    return workspace.getConfiguration('lean4').get('infoViewAllErrorsOnLine', true)
}

export function getInfoViewDebounceTime(): number {
    return workspace.getConfiguration('lean4.infoview').get('debounceTime', 50)
}

function getInfoViewShowExpectedType(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('showExpectedType', true)
}

export function getInfoViewExpectedTypeVisibility(): 'Expanded by default' | 'Collapsed by default' | 'Hidden' {
    const show = getInfoViewShowExpectedType()
    const visibility = workspace.getConfiguration('lean4.infoview').get('expectedTypeVisibility', 'Expanded by default')
    if (!show && visibility === 'Expanded by default') {
        return 'Collapsed by default'
    }
    return visibility
}

export function getInfoViewShowGoalNames(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('showGoalNames', true)
}

export function getInfoViewEmphasizeFirstGoal(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('emphasizeFirstGoal', false)
}

export function getInfoViewReverseTacticState(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('reverseTacticState', false)
}

export function getInfoViewHideTypeAssumptions(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('hideTypeAssumptions', false)
}

export function getInfoViewHideInstanceAssumptions(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('hideInstanceAssumptions', false)
}

export function getInfoViewHideInaccessibleAssumptions(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('hideInaccessibleAssumptions', false)
}

export function getInfoViewHideLetValues(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('hideLetValues', false)
}

export function getInfoViewShowTooltipOnHover(): boolean {
    return workspace.getConfiguration('lean4.infoview').get('showTooltipOnHover', true)
}

export function getElaborationDelay(): number {
    return workspace.getConfiguration('lean4').get('elaborationDelay', 200)
}

export function shouldShowSetupWarnings(): boolean {
    return workspace.getConfiguration('lean4').get('showSetupWarnings', true)
}

export function getFallBackToStringOccurrenceHighlighting(): boolean {
    return workspace.getConfiguration('lean4').get('fallBackToStringOccurrenceHighlighting', false)
}

export function showDiagnosticGutterDecorations(): boolean {
    return workspace.getConfiguration('lean4').get('showDiagnosticGutterDecorations', true)
}

export function showUnsolvedGoalsDecoration(): boolean {
    return workspace.getConfiguration('lean4').get('showUnsolvedGoalsDecoration', true)
}

export function unsolvedGoalsDecorationLightThemeColor(): ThemeColor | string {
    return processConfigColor(
        workspace.getConfiguration('lean4').get('unsolvedGoalsDecorationLightThemeColor', 'editorInfo.foreground'),
    )
}

export function unsolvedGoalsDecorationDarkThemeColor(): ThemeColor | string {
    return processConfigColor(
        workspace.getConfiguration('lean4').get('unsolvedGoalsDecorationDarkThemeColor', 'editorInfo.foreground'),
    )
}

export function goalsAccomplishedDecorationKind(): string {
    return workspace.getConfiguration('lean4').get('goalsAccomplishedDecorationKind', 'Double Checkmark')
}

export function decorationEditDelay(): number {
    return workspace.getConfiguration('lean4').get('decorationEditDelay', 750)
}

export function isRunningTest(): boolean {
    return typeof process.env.LEAN4_TEST_FOLDER === 'string'
}

export function getTestFolder(): string {
    return typeof process.env.LEAN4_TEST_FOLDER === 'string' ? process.env.LEAN4_TEST_FOLDER : ''
}

export function getDefaultLeanVersion(): string {
    return typeof process.env.DEFAULT_LEAN_TOOLCHAIN === 'string'
        ? process.env.DEFAULT_LEAN_TOOLCHAIN
        : elanStableChannel
}

/** The editor line height, in pixels. */
export function getEditorLineHeight(): number {
    // The implementation
    // (recommended by Microsoft: https://github.com/microsoft/vscode/issues/125341#issuecomment-854812591)
    // is absolutely cursed. It's just to copy whatever VSCode does internally.
    const fontSize = workspace.getConfiguration('editor').get<number>('fontSize') ?? 0
    let lineHeight = workspace.getConfiguration('editor').get<number>('lineHeight') ?? 0

    const GOLDEN_LINE_HEIGHT_RATIO = process.platform === 'darwin' ? 1.5 : 1.35
    const MINIMUM_LINE_HEIGHT = 8

    if (lineHeight === 0) {
        lineHeight = GOLDEN_LINE_HEIGHT_RATIO * fontSize
    } else if (lineHeight < MINIMUM_LINE_HEIGHT) {
        // Values too small to be line heights in pixels are in ems.
        lineHeight = lineHeight * fontSize
    }

    // Enforce integer, minimum constraints
    lineHeight = Math.round(lineHeight)
    if (lineHeight < MINIMUM_LINE_HEIGHT) {
        lineHeight = MINIMUM_LINE_HEIGHT
    }

    return lineHeight
}

/**
 * The literal 'production' or 'development', depending on the build.
 * Should be turned into a string literal by build tools.
 */
export const prodOrDev: string =
    process.env.NODE_ENV && process.env.NODE_ENV === 'production' ? 'production' : 'development'

/** The literal '.min' or empty, depending on the build. See {@link prodOrDev}. */
export const minIfProd: string = process.env.NODE_ENV && process.env.NODE_ENV === 'production' ? '.min' : ''
