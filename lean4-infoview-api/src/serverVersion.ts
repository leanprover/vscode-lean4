/**
 * Keeps track of the Lean server version and available features.
 * @module
 */

export class ServerVersion {
    constructor(
        public major: number,
        public minor: number,
        public patch: number,
    ) {}

    static ofString(version: string): ServerVersion {
        const vs = version.split('.')
        if (vs.length === 2) {
            return new ServerVersion(parseInt(vs[0]), parseInt(vs[1]), 0)
        } else if (vs.length === 3) {
            return new ServerVersion(parseInt(vs[0]), parseInt(vs[1]), parseInt(vs[2]))
        } else {
            throw new Error(`cannot parse Lean server version '${version}'`)
        }
    }

    /** Is `this` version equal to `other`? */
    eq(other: ServerVersion): boolean {
        return this.major === other.major && this.minor === other.minor && this.patch === other.patch
    }

    /** Is `this` version strictly below `other`? */
    lt(other: ServerVersion): boolean {
        if (this.major !== other.major) return this.major < other.major
        if (this.minor !== other.minor) return this.minor < other.minor
        return this.patch < other.patch
    }

    /** Is `this` version either strictly below or equal to `other`? */
    le(other: ServerVersion): boolean {
        return this.lt(other) || this.eq(other)
    }
}
