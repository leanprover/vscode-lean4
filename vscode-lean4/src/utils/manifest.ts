import * as fs from 'fs'
import { SemVer } from 'semver'
import { Uri } from 'vscode'
import { z } from 'zod'
import { FileUri } from './exturi'

// Suggested at https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const semVerRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export interface DirectGitDependency {
    name: string
    uri: Uri
    revision: string
    inputRevision: string
}

export interface Manifest {
    packagesDir: string
    directGitDependencies: DirectGitDependency[]
}

type ManifestVersion = { kind: 'LegacyNumberVersion'; version: number } | { kind: 'SemVer'; version: SemVer }

function asManifestVersion(versionField: number | string): ManifestVersion {
    switch (typeof versionField) {
        case 'string':
            return { kind: 'SemVer', version: new SemVer(versionField) }
        case 'number':
            return { kind: 'LegacyNumberVersion', version: versionField }
    }
}

function parseVersion1To6Manifest(parsedJson: any) {
    const version1To6ManifestSchema = z.object({
        packagesDir: z.string(),
        packages: z.array(
            z.union([
                z.object({
                    git: z.object({
                        name: z.string(),
                        url: z.string().url(),
                        rev: z.string(),
                        inherited: z.boolean(),
                        'inputRev?': z.optional(z.nullable(z.string())),
                    }),
                }),
                z.object({
                    path: z.any(),
                }),
            ]),
        ),
    })

    const result = version1To6ManifestSchema.safeParse(parsedJson)
    if (!result.success) {
        return undefined
    }

    const manifest: Manifest = { packagesDir: result.data.packagesDir, directGitDependencies: [] }

    for (const pkg of result.data.packages) {
        if (!('git' in pkg)) {
            continue
        }
        if (pkg.git.inherited) {
            continue // Inherited Git packages are not direct dependencies
        }

        manifest.directGitDependencies.push({
            name: pkg.git.name,
            uri: Uri.parse(pkg.git.url),
            revision: pkg.git.rev,
            inputRevision: pkg.git['inputRev?'] ?? 'master', // Lake also always falls back to master
        })
    }

    return manifest
}

function parseVersion7ToNManifest(parsedJson: any) {
    const version7ToNManifestSchema = z.object({
        packagesDir: z.string(),
        packages: z.array(
            z.union([
                z.object({
                    type: z.literal('git'),
                    name: z.string(),
                    url: z.string().url(),
                    rev: z.string(),
                    inherited: z.boolean(),
                    inputRev: z.optional(z.nullable(z.string())),
                }),
                z.object({
                    type: z.literal('path'),
                }),
            ]),
        ),
    })

    const result = version7ToNManifestSchema.safeParse(parsedJson)
    if (!result.success) {
        return undefined
    }

    const manifest: Manifest = { packagesDir: result.data.packagesDir, directGitDependencies: [] }

    for (const pkg of result.data.packages) {
        if (pkg.type !== 'git') {
            continue
        }
        if (pkg.inherited) {
            continue // Inherited Git packages are not direct dependencies
        }

        manifest.directGitDependencies.push({
            name: pkg.name,
            uri: Uri.parse(pkg.url),
            revision: pkg.rev,
            inputRevision: pkg.inputRev ?? 'master', // Lake also always falls back to master
        })
    }

    return manifest
}

export function parseAsManifest(jsonString: string): Manifest | undefined {
    let parsedJson: any
    try {
        parsedJson = JSON.parse(jsonString)
    } catch (e) {
        return undefined
    }

    const versionSchema = z.object({
        version: z.union([z.number().int().nonnegative(), z.string().regex(semVerRegex)]),
    })
    const versionResult = versionSchema.safeParse(parsedJson)
    if (!versionResult.success) {
        return undefined
    }
    const version = asManifestVersion(versionResult.data.version)

    if (version.kind === 'LegacyNumberVersion' && version.version <= 6) {
        return parseVersion1To6Manifest(parsedJson)
    } else {
        return parseVersion7ToNManifest(parsedJson)
    }
}

export type ManifestReadError = string

export async function parseManifestInFolder(folderUri: FileUri): Promise<Manifest | ManifestReadError> {
    const manifestPath: string = folderUri.join('lake-manifest.json').fsPath

    let jsonString: string
    try {
        jsonString = fs.readFileSync(manifestPath, 'utf8')
    } catch (e) {
        return `Cannot read 'lake-manifest.json' file at ${manifestPath} to determine dependencies.`
    }

    const manifest: Manifest | undefined = parseAsManifest(jsonString)
    if (!manifest) {
        return `Cannot parse 'lake-manifest.json' file at ${manifestPath} to determine dependencies.`
    }

    return manifest
}
