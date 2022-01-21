
export class Version {
    major: number = 0
    minor: number = 0
    patch: number = 0
    label: string = null;

    constructor(version: string){
        // chop off any parens, e.g. Lake version 3.0.0-pre (Lean version 4.0.0-nightly-2022-01-20)
        let pos = version.indexOf('(');
        if (pos >= 0) version = version.substring(0, pos).trim();
        pos = version.indexOf('-');
        const versionNumber = pos > 0 ? version.substring(0, pos).trim() : version;
        this.label = pos > 0 ? version.substring(pos + 1).trim() : null;
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
        // assume any label is a "pre-release" version like "3.0.0-pre" < "3.0.0"
        if (!this.label && v2.label) return 1;
        if (this.label && !v2.label) return -1;
        // todo: what if they both have a different pre-release label?
        return 0;
    }
}
