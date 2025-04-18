import { SemVer } from 'semver'
import { OutputChannel } from 'vscode'
import { z, ZodTypeAny } from 'zod'
import { batchExecute, batchExecuteWithProgress, ExecutionExitCode, ExecutionResult } from './batch'
import { FileUri } from './exturi'
import { groupByUniqueKey } from './groupBy'
import { semVerRegex } from './semverRegex'

export const elanStableChannel = 'leanprover/lean4:stable'
export const elanNightlyChannel = 'leanprover/lean4:nightly'

export const elanEagerResolutionMajorVersion = 4

export function isElanEagerResolutionVersion(version: SemVer) {
    return version.major >= elanEagerResolutionMajorVersion
}

const elanVersionRegex =
    /^elan ((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)/

export type ElanVersionResult =
    | { kind: 'Success'; version: SemVer }
    | { kind: 'ElanNotInstalled' }
    | { kind: 'ExecutionError'; message: string }

export async function elanVersion(): Promise<ElanVersionResult> {
    const r = await batchExecute('elan', ['--version'])
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            const match = elanVersionRegex.exec(r.stdout)
            if (match === null) {
                return { kind: 'ExecutionError', message: 'Cannot parse output of `elan --version`: ' + r.stdout }
            }
            return { kind: 'Success', version: new SemVer(match[1]) }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotInstalled' }
        case ExecutionExitCode.ExecutionError:
            return { kind: 'ExecutionError', message: r.combined }
        case ExecutionExitCode.Cancelled:
            throw new Error('Unexpected cancellation of `elan --version`')
    }
}

export async function elanSelfUpdate(
    channel: OutputChannel | undefined,
    context: string | undefined,
): Promise<ExecutionResult> {
    return await batchExecuteWithProgress('elan', ['self', 'update'], context, 'Updating Elan', { channel })
}

export type ElanOption<T> = T | undefined
export type ElanResult<T> = { kind: 'Ok'; value: T } | { kind: 'Error'; message: string }

export type ElanVersion = {
    current: SemVer
    newest: ElanResult<SemVer>
}

export type ElanInstalledToolchain = {
    resolvedName: string
    path: FileUri
}

export type ElanLocalUnresolvedToolchain = { kind: 'Local'; toolchain: string }
export type ElanRemoteUnresolvedToolchain = {
    kind: 'Remote'
    githubRepoOrigin: string
    release: string
    fromChannel: ElanOption<string>
}

export type ElanUnresolvedToolchain = ElanLocalUnresolvedToolchain | ElanRemoteUnresolvedToolchain

export namespace ElanUnresolvedToolchain {
    export function toolchainName(unresolved: ElanUnresolvedToolchain): string {
        switch (unresolved.kind) {
            case 'Local':
                return unresolved.toolchain
            case 'Remote':
                return unresolved.githubRepoOrigin + ':' + unresolved.release
        }
    }
}

export type ElanToolchainResolution = {
    resolvedToolchain: ElanResult<string>
    cachedToolchain: ElanOption<string>
}

export type ElanDefaultToolchain = {
    unresolved: ElanUnresolvedToolchain
    resolved: ElanToolchainResolution
}

export type ElanOverrideReason =
    | { kind: 'Environment' }
    | { kind: 'Manual'; directoryPath: FileUri }
    | { kind: 'ToolchainFile'; toolchainPath: FileUri }
    | { kind: 'LeanpkgFile'; leanpkgPath: FileUri }
    | { kind: 'ToolchainDirectory'; directoryPath: FileUri }

export type ElanOverride = {
    unresolved: ElanUnresolvedToolchain
    reason: ElanOverrideReason
}

export type ElanToolchains = {
    installed: Map<string, ElanInstalledToolchain>
    default: ElanOption<ElanDefaultToolchain>
    activeOverride: ElanOption<ElanOverride>
    resolvedActive: ElanOption<ElanToolchainResolution>
}

export namespace ElanToolchains {
    export function unresolvedToolchain(toolchains: ElanToolchains): ElanOption<ElanUnresolvedToolchain> {
        return toolchains.activeOverride?.unresolved ?? toolchains.default?.unresolved
    }

    export function unresolvedToolchainName(toolchains: ElanToolchains): ElanOption<string> {
        const unresolvedToolchain = ElanToolchains.unresolvedToolchain(toolchains)
        if (unresolvedToolchain === undefined) {
            return undefined
        }
        return ElanUnresolvedToolchain.toolchainName(unresolvedToolchain)
    }
}

export type ElanStateDump = {
    elanVersion: ElanVersion
    toolchains: ElanToolchains
}

function zodElanResult<T extends ZodTypeAny>(zodValue: T) {
    return z.union([
        z.object({
            Ok: zodValue,
        }),
        z.object({
            Err: z.string(),
        }),
    ])
}

function zodElanUnresolvedToolchain() {
    return z.union([
        z.object({
            Local: z.object({
                name: z.string(),
            }),
        }),
        z.object({
            Remote: z.object({
                origin: z.string(),
                release: z.string(),
                from_channel: z.nullable(z.string()),
            }),
        }),
    ])
}

function zodElanToolchainResolution() {
    return z.object({
        live: zodElanResult(z.string()),
        cached: z.nullable(z.string()),
    })
}

function convertElanResult<T, V>(
    zodResult:
        | {
              Ok: T
          }
        | {
              Err: string
          },
    f: (v: T) => V,
): ElanResult<V> {
    if ('Ok' in zodResult) {
        return { kind: 'Ok', value: f(zodResult.Ok) }
    }
    zodResult satisfies {
        Err: string
    }
    return { kind: 'Error', message: zodResult.Err }
}

function convertElanOption<T, V>(zodNullable: T | null, f: (v: T) => V): ElanOption<V> {
    if (zodNullable === null) {
        return undefined
    }
    return f(zodNullable)
}

function convertElanUnresolvedToolchain(
    zodElanUnresolvedToolchain:
        | {
              Local: {
                  name: string
              }
          }
        | {
              Remote: {
                  origin: string
                  release: string
                  from_channel: string | null
              }
          },
): ElanUnresolvedToolchain {
    if ('Local' in zodElanUnresolvedToolchain) {
        return { kind: 'Local', toolchain: zodElanUnresolvedToolchain.Local.name }
    }
    zodElanUnresolvedToolchain satisfies {
        Remote: {
            origin: string
            release: string
            from_channel: string | null
        }
    }
    return {
        kind: 'Remote',
        githubRepoOrigin: zodElanUnresolvedToolchain.Remote.origin,
        release: zodElanUnresolvedToolchain.Remote.release,
        fromChannel: convertElanOption(zodElanUnresolvedToolchain.Remote.from_channel, c => c),
    }
}

function covertElanToolchainResolution(
    installed: Map<string, ElanInstalledToolchain>,
    zodElanToolchainResolution: {
        live:
            | {
                  Ok: string
              }
            | {
                  Err: string
              }
        cached: string | null
    },
): ElanToolchainResolution {
    let cachedToolchain = convertElanOption(zodElanToolchainResolution.cached, t => t)
    if (cachedToolchain !== undefined && !installed.has(cachedToolchain)) {
        cachedToolchain = undefined
    }
    return {
        resolvedToolchain: convertElanResult(zodElanToolchainResolution.live, t => t),
        cachedToolchain,
    }
}

function convertElanOverrideReason(
    zodElanOverrideReason:
        | 'Environment'
        | {
              OverrideDB: string
          }
        | {
              ToolchainFile: string
          }
        | {
              LeanpkgFile: string
          }
        | {
              InToolchainDirectory: string
          },
): ElanOverrideReason {
    if (zodElanOverrideReason === 'Environment') {
        return { kind: 'Environment' }
    }
    if ('OverrideDB' in zodElanOverrideReason) {
        return { kind: 'Manual', directoryPath: new FileUri(zodElanOverrideReason.OverrideDB) }
    }
    if ('ToolchainFile' in zodElanOverrideReason) {
        return { kind: 'ToolchainFile', toolchainPath: new FileUri(zodElanOverrideReason.ToolchainFile) }
    }
    if ('LeanpkgFile' in zodElanOverrideReason) {
        return { kind: 'LeanpkgFile', leanpkgPath: new FileUri(zodElanOverrideReason.LeanpkgFile) }
    }
    zodElanOverrideReason satisfies { InToolchainDirectory: string }
    return { kind: 'ToolchainDirectory', directoryPath: new FileUri(zodElanOverrideReason.InToolchainDirectory) }
}

function parseElanStateDump(elanDumpStateOutput: string): ElanStateDump | undefined {
    let parsedJson: any
    try {
        parsedJson = JSON.parse(elanDumpStateOutput)
    } catch (e) {
        return undefined
    }

    const stateDumpSchema = z.object({
        elan_version: z.object({
            current: z.string().regex(semVerRegex),
            newest: zodElanResult(z.string().regex(semVerRegex)),
        }),
        toolchains: z.object({
            installed: z.array(
                z.object({
                    resolved_name: z.string(),
                    path: z.string(),
                }),
            ),
            default: z.nullable(
                z.object({
                    unresolved: zodElanUnresolvedToolchain(),
                    resolved: zodElanToolchainResolution(),
                }),
            ),
            active_override: z.nullable(
                z.object({
                    unresolved: zodElanUnresolvedToolchain(),
                    reason: z.union([
                        z.literal('Environment'),
                        z.object({ OverrideDB: z.string() }),
                        z.object({ ToolchainFile: z.string() }),
                        z.object({ LeanpkgFile: z.string() }),
                        z.object({ InToolchainDirectory: z.string() }),
                    ]),
                }),
            ),
            resolved_active: z.nullable(zodElanToolchainResolution()),
        }),
    })
    const stateDumpResult = stateDumpSchema.safeParse(parsedJson)
    if (!stateDumpResult.success) {
        return undefined
    }
    const s = stateDumpResult.data

    const installed = groupByUniqueKey(
        s.toolchains.installed.map(i => ({ resolvedName: i.resolved_name, path: new FileUri(i.path) })),
        i => i.resolvedName,
    )

    const stateDump: ElanStateDump = {
        elanVersion: {
            current: new SemVer(s.elan_version.current),
            newest: convertElanResult(s.elan_version.newest, version => new SemVer(version)),
        },
        toolchains: {
            installed,
            default: convertElanOption(s.toolchains.default, d => ({
                unresolved: convertElanUnresolvedToolchain(d.unresolved),
                resolved: covertElanToolchainResolution(installed, d.resolved),
            })),
            activeOverride: convertElanOption(s.toolchains.active_override, r => ({
                reason: convertElanOverrideReason(r.reason),
                unresolved: convertElanUnresolvedToolchain(r.unresolved),
            })),
            resolvedActive: convertElanOption(s.toolchains.resolved_active, r =>
                covertElanToolchainResolution(installed, r),
            ),
        },
    }
    return stateDump
}

export type ElanDumpStateWithoutNetResult =
    | { kind: 'Success'; state: ElanStateDump }
    | { kind: 'ElanNotFound' }
    | { kind: 'ExecutionError'; message: string }

export type ElanDumpStateWithNetResult = ElanDumpStateWithoutNetResult | { kind: 'Cancelled' }

function toolchainEnvExtensions(toolchain: string | undefined): { [key: string]: string } | undefined {
    if (toolchain === undefined) {
        return undefined
    }
    return {
        ELAN_TOOLCHAIN: toolchain,
    }
}

export async function elanDumpStateWithoutNet(
    cwdUri: FileUri | undefined,
    toolchain?: string | undefined,
): Promise<ElanDumpStateWithoutNetResult> {
    const r = await batchExecute(
        'elan',
        ['dump-state', '--no-net'],
        cwdUri?.fsPath,
        undefined,
        toolchainEnvExtensions(toolchain),
    )
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            const state = parseElanStateDump(r.stdout)
            if (state === undefined) {
                return { kind: 'ExecutionError', message: 'Cannot parse output of `elan dump-state --no-net`.' }
            }
            return { kind: 'Success', state }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotFound' }
        case ExecutionExitCode.ExecutionError:
            return { kind: 'ExecutionError', message: r.combined }
        case ExecutionExitCode.Cancelled:
            throw new Error('Unexpected cancellation of `elan dump-state --no-net`')
    }
}

export async function elanDumpStateWithNet(
    cwdUri: FileUri | undefined,
    context: string | undefined,
    toolchain?: string | undefined,
): Promise<ElanDumpStateWithNetResult> {
    const r = await batchExecuteWithProgress('elan', ['dump-state'], context, 'Fetching Lean version information', {
        cwd: cwdUri?.fsPath,
        allowCancellation: true,
        envExtensions: toolchainEnvExtensions(toolchain),
    })
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            const state = parseElanStateDump(r.stdout)
            if (state === undefined) {
                return { kind: 'ExecutionError', message: 'Cannot parse output of `elan dump-state`.' }
            }
            return { kind: 'Success', state }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotFound' }
        case ExecutionExitCode.ExecutionError:
            return { kind: 'ExecutionError', message: r.combined }
        case ExecutionExitCode.Cancelled:
            return { kind: 'Cancelled' }
    }
}

export type ElanInstalledToolchainsResult =
    | { kind: 'Success'; toolchains: string[]; defaultToolchain: string | undefined }
    | { kind: 'ElanNotFound' }
    | { kind: 'ExecutionError'; message: string }

export async function elanInstalledToolchains(): Promise<ElanInstalledToolchainsResult> {
    const stateDumpResult = await elanDumpStateWithoutNet(undefined)

    if (stateDumpResult.kind === 'ExecutionError') {
        // User is probably on a pre-eager toolchain resolution elan version which did not yet support
        // `elan dump-state`. Fall back to parsing the toolchain with `elan toolchain list`.
        const r = await batchExecute('elan', ['toolchain', 'list'])
        switch (r.exitCode) {
            case ExecutionExitCode.Success:
                const lines = r.stdout
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                const toolchainInfo: [string, boolean][] = lines.map(line => [
                    line.replace(/\(default\)$/, '').trim(),
                    line.endsWith('(default)'),
                ])
                const toolchains = toolchainInfo.map(([toolchain, _]) => toolchain)
                const defaultToolchain = toolchainInfo.find(([_, isDefault]) => isDefault)?.[0]
                return { kind: 'Success', toolchains, defaultToolchain }
            case ExecutionExitCode.CannotLaunch:
                return { kind: 'ElanNotFound' }
            case ExecutionExitCode.ExecutionError:
                return { kind: 'ExecutionError', message: r.combined }
            case ExecutionExitCode.Cancelled:
                throw new Error('Unexpected cancellation of `elan toolchain list`')
        }
    }

    if (stateDumpResult.kind === 'ElanNotFound') {
        return stateDumpResult
    }

    stateDumpResult.kind satisfies 'Success'
    const installedToolchains = [...stateDumpResult.state.toolchains.installed.values()].map(t => t.resolvedName)
    const defaultToolchain = stateDumpResult.state.toolchains.default
    if (defaultToolchain === undefined) {
        return { kind: 'Success', toolchains: installedToolchains, defaultToolchain: undefined }
    }
    return {
        kind: 'Success',
        toolchains: installedToolchains,
        defaultToolchain: ElanUnresolvedToolchain.toolchainName(defaultToolchain.unresolved),
    }
}

export type ActiveToolchainInfo = {
    unresolvedToolchain: string
    cachedToolchain: string | undefined
    resolvedToolchain: string
    origin: ElanOverrideReason | { kind: 'Default' }
}

export type ElanActiveToolchainResult =
    | { kind: 'ElanNotFound' }
    | { kind: 'ExecutionError'; message: string }
    | { kind: 'Cancelled' }
    | { kind: 'NoActiveToolchain' }
    | {
          kind: 'Success'
          info: ActiveToolchainInfo
      }

export async function elanActiveToolchain(
    cwdUri: FileUri | undefined,
    context: string | undefined,
    toolchain?: string | undefined,
): Promise<ElanActiveToolchainResult> {
    const stateDumpResult = await elanDumpStateWithNet(cwdUri, context, toolchain)
    if (stateDumpResult.kind !== 'Success') {
        return stateDumpResult
    }

    const unresolvedToolchain = ElanToolchains.unresolvedToolchainName(stateDumpResult.state.toolchains)
    if (unresolvedToolchain === undefined) {
        return { kind: 'NoActiveToolchain' }
    }

    const toolchainResolution = stateDumpResult.state.toolchains.resolvedActive
    if (toolchainResolution === undefined) {
        return { kind: 'NoActiveToolchain' }
    }

    const cachedToolchain = toolchainResolution.cachedToolchain
    const resolvedToolchainResult = toolchainResolution.resolvedToolchain

    if (resolvedToolchainResult.kind === 'Error') {
        return { kind: 'ExecutionError', message: resolvedToolchainResult.message }
    }
    const resolvedToolchain = resolvedToolchainResult.value

    const overrideReason = stateDumpResult.state.toolchains.activeOverride?.reason
    const origin: ElanOverrideReason | { kind: 'Default' } =
        overrideReason !== undefined ? overrideReason : { kind: 'Default' }

    return { kind: 'Success', info: { unresolvedToolchain, cachedToolchain, resolvedToolchain, origin } }
}

export function toolchainVersion(toolchain: string): string {
    const toolchainRegex = /(.+)\/(.+):(.+)/
    const match = toolchainRegex.exec(toolchain)
    if (match === null) {
        return toolchain
    }
    return match[3]
}

export type ElanInstallToolchainResult =
    | { kind: 'Success' }
    | { kind: 'ElanNotFound' }
    | { kind: 'ToolchainAlreadyInstalled' }
    | { kind: 'Error'; message: string }
    | { kind: 'Cancelled' }

export async function elanInstallToolchain(
    channel: OutputChannel | undefined,
    context: string | undefined,
    toolchain: string,
): Promise<ElanInstallToolchainResult> {
    const r = await batchExecuteWithProgress(
        'elan',
        ['toolchain', 'install', toolchain],
        context,
        `Installing ${toolchain}`,
        {
            channel,
            allowCancellation: true,
        },
    )
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            return { kind: 'Success' }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotFound' }
        case ExecutionExitCode.ExecutionError:
            if (r.stderr.match(/error: '.*' is already installed/) !== null) {
                return { kind: 'ToolchainAlreadyInstalled' }
            } else {
                return { kind: 'Error', message: r.combined }
            }
        case ExecutionExitCode.Cancelled:
            return { kind: 'Cancelled' }
    }
}

export async function elanUninstallToolchains(
    channel: OutputChannel | undefined,
    context: string | undefined,
    toolchains: string[],
): Promise<ExecutionResult> {
    if (toolchains.length === 0) {
        throw new Error('Cannot uninstall zero toolchains.')
    }
    const waitingPrompt =
        toolchains.length === 1
            ? `Uninstalling '${toolchains[0]}'`
            : `Uninstalling Lean versions ${toolchains.map(t => `'${t}'`).join(', ')}`
    return await batchExecuteWithProgress('elan', ['toolchain', 'uninstall', ...toolchains], context, waitingPrompt, {
        channel,
        allowCancellation: true,
    })
}

export async function elanSelfUninstall(
    channel: OutputChannel | undefined,
    context: string | undefined,
): Promise<ExecutionResult> {
    return await batchExecuteWithProgress('elan', ['self', 'uninstall', '-y'], context, 'Uninstalling Elan', {
        channel,
        allowCancellation: true,
    })
}

export type ElanSetDefaultToolchainResult =
    | { kind: 'Success' }
    | { kind: 'ElanNotFound' }
    | { kind: 'Error'; message: string }

export async function elanSetDefaultToolchain(
    channel: OutputChannel | undefined,
    toolchain: string,
): Promise<ElanSetDefaultToolchainResult> {
    const r = await batchExecute('elan', ['default', toolchain], undefined, { combined: channel })
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            return { kind: 'Success' }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotFound' }
        case ExecutionExitCode.ExecutionError:
            return { kind: 'Error', message: r.combined }
        case ExecutionExitCode.Cancelled:
            throw new Error('Unexpected cancellation of `elan default <toolchain>`')
    }
}

export type ElanUsedToolchain = {
    user: string
    toolchain: string
}

export type ElanGcInfo = {
    unusedToolchains: string[]
    usedToolchains: ElanUsedToolchain[]
}

function parseElanGcJson(jsonOutput: string): ElanGcInfo | undefined {
    let parsedJson: any
    try {
        parsedJson = JSON.parse(jsonOutput)
    } catch (e) {
        return undefined
    }

    const elanGcJsonSchema = z.object({
        unused_toolchains: z.array(z.string()),
        used_toolchains: z.array(
            z.object({
                user: z.string(),
                toolchain: z.string(),
            }),
        ),
    })
    const elanGcJsonResult = elanGcJsonSchema.safeParse(parsedJson)
    if (!elanGcJsonResult.success) {
        return undefined
    }
    const elanGcJson = elanGcJsonResult.data

    return {
        unusedToolchains: elanGcJson.unused_toolchains,
        usedToolchains: elanGcJson.used_toolchains,
    }
}

export type ElanQueryGcResult =
    | { kind: 'Success'; info: ElanGcInfo }
    | { kind: 'ElanNotFound' }
    | { kind: 'ExecutionError'; message: string }

export async function elanQueryGc(): Promise<ElanQueryGcResult> {
    const r = await batchExecute('elan', ['toolchain', 'gc', '--json'])
    switch (r.exitCode) {
        case ExecutionExitCode.Success:
            const info = parseElanGcJson(r.stdout)
            if (info === undefined) {
                return { kind: 'ExecutionError', message: 'Cannot parse output of `elan toolchain gc --json`' }
            }
            return { kind: 'Success', info }
        case ExecutionExitCode.CannotLaunch:
            return { kind: 'ElanNotFound' }
        case ExecutionExitCode.ExecutionError:
            return { kind: 'ExecutionError', message: r.combined }
        case ExecutionExitCode.Cancelled:
            throw new Error('Unexpected cancellation of `elan toolchain gc --json`.')
    }
}

export async function elanGC(
    channel: OutputChannel | undefined,
    context: string | undefined,
): Promise<ExecutionResult> {
    return await batchExecuteWithProgress(
        'elan',
        ['toolchain', 'gc', '--delete'],
        context,
        'Removing unused Lean versions',
        {
            channel,
            allowCancellation: true,
        },
    )
}
