/**
 * Keeps track of the Lean server version and available features.
 * @module
 */

export class ServerVersion {
    major: number
    minor: number
    patch: number

    constructor(version: string) {
        const vs = version.split('.')
        if (vs.length === 2) {
            this.major = parseInt(vs[0])
            this.minor = parseInt(vs[1])
            this.patch = 0
        } else if (vs.length === 3) {
            this.major = parseInt(vs[0])
            this.minor = parseInt(vs[1])
            this.patch = parseInt(vs[2])
        } else {
            throw new Error(`cannot parse Lean server version '${version}'`)
        }
    }

    /** Supports the first version of the widget RPC protocol. */
    // TODO(WN): remove this and all uses once we drop support for servers older than 2021-08-25
    hasWidgetsV1(): boolean {
        return this.minor >= 1
    }
}
