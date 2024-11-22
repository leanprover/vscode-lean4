import { ProgressLocation, ProgressOptions, window } from 'vscode'
import { z } from 'zod'

async function fetchJson(
    context: string | undefined,
): Promise<{ kind: 'Success'; result: any } | { kind: 'CannotFetch'; error: string } | { kind: 'CannotParse' }> {
    const titlePrefix = context ? `[${context}] ` : ''
    const progressOptions: ProgressOptions = {
        location: ProgressLocation.Notification,
        title: titlePrefix + 'Querying Lean release information',
        cancellable: true,
    }

    let r: Response
    try {
        r = await window.withProgress(progressOptions, async (_, tk) => {
            const controller = new AbortController()
            const signal = controller.signal
            tk.onCancellationRequested(() => controller.abort())
            return await fetch('https://release.lean-lang.org/', {
                signal,
            })
        })
    } catch (e) {
        if (e instanceof Error) {
            return { kind: 'CannotFetch', error: e.message }
        }
        return { kind: 'CannotFetch', error: 'Unknown error' }
    }

    let j: any
    try {
        j = await r.json()
    } catch (e) {
        return { kind: 'CannotParse' }
    }
    return { kind: 'Success', result: j }
}

function zodReleaseChannel() {
    return z.array(
        z.object({
            name: z.string(),
            created_at: z.string().datetime(),
        }),
    )
}

export type LeanRelease = {
    name: string
    creationDate: Date
}

export type LeanReleaseChannel = LeanRelease[]

export type LeanReleases = {
    version: string
    stable: LeanReleaseChannel
    beta: LeanReleaseChannel
    nightly: LeanReleaseChannel
}

function convertLeanReleaseChannel(
    zodReleaseChannel: {
        name: string
        created_at: string
    }[],
): LeanReleaseChannel {
    return zodReleaseChannel.map(release => ({
        name: release.name,
        creationDate: new Date(release.created_at),
    }))
}

function parseLeanReleases(json: any): LeanReleases | undefined {
    const leanReleasesSchema = z.object({
        version: z.string(),
        stable: zodReleaseChannel(),
        beta: zodReleaseChannel(),
        nightly: zodReleaseChannel(),
    })
    const r = leanReleasesSchema.safeParse(json)
    if (!r.success) {
        return undefined
    }
    return {
        version: r.data.version,
        stable: convertLeanReleaseChannel(r.data.stable),
        beta: convertLeanReleaseChannel(r.data.beta),
        nightly: convertLeanReleaseChannel(r.data.nightly),
    }
}

export type LeanReleasesQueryResult =
    | { kind: 'Success'; releases: LeanReleases }
    | { kind: 'CannotFetch'; error: string }
    | { kind: 'CannotParse' }
    | { kind: 'Cancelled' }

export async function queryLeanReleases(context: string | undefined): Promise<LeanReleasesQueryResult> {
    const fetchJsonResult = await fetchJson(context)
    if (fetchJsonResult.kind !== 'Success') {
        return fetchJsonResult
    }
    const json = fetchJsonResult.result
    const releases = parseLeanReleases(json)
    if (releases === undefined) {
        return { kind: 'CannotParse' }
    }
    return { kind: 'Success', releases }
}
