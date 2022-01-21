
export class Version {
    major: number = 0
    minor: number = 0
    patch: number = 0

    constructor(version: string){
        // chop off any parens, e.g. Lake version 3.0.0-pre (Lean version 4.0.0-nightly-2022-01-20)
        const pos = version.indexOf('(');
        if (pos >= 0) version = version.substring(0, pos).trim();
        const versionNumber = version.split('-')[0]; // chop off any suffix like "-pre"
        const parts = versionNumber.split('.');
        this.major = this.tryParseInt(parts[0], 0);
        this.minor = this.tryParseInt(parts[1], 0);
        this.patch = this.tryParseInt(parts[2], 0);
    }

    tryParseInt(v: string, defaultValue: number): number {
        const n = parseInt(v);
        if (isNaN(n)) return defaultValue;
        return n;
    }

    compare(v2: Version){
        if (this.major > v2.major) return 1;
        if (this.major < v2.major) return -1;
        if (this.minor > v2.minor) return 1;
        if (this.minor < v2.minor) return -1;
        if (this.patch > v2.patch) return 1;
        if (this.patch < v2.patch) return -1;
        return 0;
    }
}
