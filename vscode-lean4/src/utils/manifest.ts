import { Uri } from 'vscode'
import { z } from 'zod';

export interface DirectGitDependency {
    name: string
    uri: Uri
    revision: string
    inputRevision: string
}

export interface Manifest {
    directGitDependencies: DirectGitDependency[]
}

export function parseAsManifest(jsonString: string): Manifest | undefined {
    let parsedJson: any
    try {
        parsedJson = JSON.parse(jsonString)
    } catch (e) {
        return undefined
    }

    const schema = z.object({
        packages: z.array(
            z.union([
                z.object({
                    git: z.object({
                        name: z.string(),
                        url: z.string().url(),
                        rev: z.string(),
                        inherited: z.boolean(),
                        'inputRev?': z.optional(z.nullable(z.string()))
                    })
                }),
                z.object({
                    path: z.any()
                })
            ])
        )
    })
    const result = schema.safeParse(parsedJson)
    if (!result.success) {
        return undefined
    }

    const manifest: Manifest = { directGitDependencies: [] }

    for (const pkg of result.data.packages) {
        if (!('git' in pkg)) {
            continue
        }
        if (pkg.git.inherited) {
            continue // Inherited Git packages are not direct dependencies
        }

        const inputRev: string | null | undefined = pkg.git['inputRev?']

        manifest.directGitDependencies.push({
            name: pkg.git.name,
            uri: Uri.parse(pkg.git.url),
            revision: pkg.git.rev,
            inputRevision: inputRev ? inputRev : 'master' // Lake also always falls back to master
        })
    }

    return manifest
}
