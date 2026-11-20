/**
 * Tests for breaking changes in the local state of the infoview API
 * (meaning anything exported from `src/index.tsx`)
 * relative to the latest published NPM release of `@leanprover/infoview`.
 * It does so by turning both packages into records in the TypeScript type system
 * and checking that one extends the other.
 * Breaking changes are permitted when the version in `lean4-infoview/package.json`
 * is a semver-breaking bump relative to the NPM release.
 *
 * @module
 */

import { exec } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'

/**
 * Recursively transform any type into a structural form suitable for testing compatibility
 * of public interfaces. For example, `private` fields are forgotten. In
 * ```typescript
 * declare class Foo { private x: number; y: number }
 * declare class Bar { private x: number; y: number }
 * ```
 * it is not true that `typeof Foo extends typeof Bar` since the `private` fields are considered
 * distinct by the type system. However the public interfaces are the same so
 * `typeof Foo extends Recordify<typeof Bar>` is true.
 */
type Recordify<T> =
    // Avoid distributing over `any` as a union:
    // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
    [T] extends [number]
        ? T
        : T extends string
          ? T
          : T extends boolean
            ? T
            : T extends bigint
              ? T
              : T extends symbol
                ? T
                : T extends undefined
                  ? T
                  : T extends null
                    ? T
                    : T extends Promise<infer U>
                      ? Promise<Recordify<U>>
                      : T extends (...args: infer As) => infer R
                        ? (..._: Recordify<As>) => Recordify<R>
                        : T extends abstract new (...args: infer As) => infer R
                          ? new (..._: Recordify<As>) => Recordify<R>
                          : { [P in keyof T]: Recordify<T[P]> }

/** Compile-time error unless the first type extends the second. */
type CheckExtends<T extends F, F> = never

// Sanity checks
type CheckAny = CheckExtends<any, Recordify<any>>
type CheckNumber = CheckExtends<number, Recordify<number>>
type CheckString = CheckExtends<string, Recordify<string>>
type CheckBoolean = CheckExtends<boolean, Recordify<boolean>>
type CheckPromise<T> = CheckExtends<Promise<Recordify<T>>, Recordify<Promise<T>>>
type CheckArray<T> = CheckExtends<Recordify<T>[], Recordify<T[]>>
declare class Foo {
    private x: number
}
declare class Bar {
    private x: number
}
type CheckPrivate = CheckExtends<typeof Foo, Recordify<typeof Bar>>
declare class Baz extends Bar {
    y: number
}
type CheckCovariant = CheckExtends<(_: any) => Baz, Recordify<(_: any) => Bar>>
type CheckContravariant = CheckExtends<Recordify<(_: Bar) => any>, (_: Baz) => any>

/** `downloadCurrentRelease` below downloads `npm:@leanprover/infoview@latest`
 * into `test/node_modules/current-release`.
 * This type won't typecheck before the release is downloaded. */
type CurrentRelease = typeof import('current-release')

type NextRelease = typeof import('../src/index')

/** Ensures that the test isn't broken. The codebase should always be compatible with itself. */
// `CheckExtends` is always `never`, so disable the redundant/duplicate union constituents lints.
/* eslint-disable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-duplicate-type-constituents */
type CheckSelfCompatible =
    | CheckExtends<Recordify<Pick<CurrentRelease, keyof CurrentRelease>>, Recordify<CurrentRelease>>
    | CheckExtends<Recordify<Pick<NextRelease, keyof NextRelease>>, Recordify<NextRelease>>
/* eslint-enable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-duplicate-type-constituents */

/**
 * Compile-time error if the current version makes any breaking changes relative to the latest release.
 * Otherwise this should typecheck. The printed error may be somewhat inscrutable but should point
 * at the source of incompatibility.
 * From https://stackoverflow.com/a/71618156
 * and https://lostintime.dev/2021/01/02/typescript-api-breaking-changes.html
 */
type CheckNoBreakingChanges = CheckExtends<
    Recordify<Pick<NextRelease, keyof CurrentRelease>>,
    Recordify<CurrentRelease>
>

/** Name of the declaration whose type errors are breaking changes. */
const breakingChangesDecl = 'CheckNoBreakingChanges'

const execAsync = promisify(exec)

/** Where the NPM release of `@leanprover/infoview` is downloaded. */
const currentReleaseDir = path.join(import.meta.dirname, 'node_modules', 'current-release')

/** Downloads the latest NPM release of `@leanprover/infoview` to `currentReleaseDir`.
 * Dependencies of the release are not downloaded:
 * its imports resolve to the packages in the repository's `node_modules`. */
async function downloadCurrentRelease(): Promise<void> {
    const dir = currentReleaseDir
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const options = { cwd: dir }
    // `npm pack` writes the tarball of the release to the working directory.
    await execAsync('npm pack @leanprover/infoview@latest --loglevel=error --no-update-notifier', options)
    const [tarball] = await readdir(dir)
    // All files of the tarball are in the folder `package`.
    await execAsync(`tar -xzf ${tarball} --strip-components=1`, options)
    await rm(path.join(dir, tarball))
}

async function readVersion(packageJson: string): Promise<string> {
    const { version } = JSON.parse(await readFile(packageJson, 'utf8')) as { version: string }
    return version
}

type Version = [major: number, minor: number, patch: number]

function parseVersion(version: string): Version {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
    if (!m) {
        throw new Error(`cannot parse '${version}' as semver`)
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** The first version that is a semver-breaking bump relative to `current`,
 * that is, the first version after the caret range `^current`.
 * This is a bump of the major version, or of the minor version for `0.x.y`, or of the patch version for `0.0.x`.
 * For example, this is `0.13.0` for `0.12.3`. */
function firstBreakingVersion([major, minor, patch]: Version): Version {
    return major > 0 ? [major + 1, 0, 0] : minor > 0 ? [0, minor + 1, 0] : [0, 0, patch + 1]
}

/** Whether the version `a` is the version `b` or a later one. */
function versionIsAtLeast(a: Version, b: Version): boolean {
    const i = a.findIndex((component, k) => component !== b[k])
    return i === -1 || a[i] > b[i]
}

/** Downloads the latest release, type-checks the project `test/tsconfig.json`,
 * and returns the exit code of the test. */
async function main(): Promise<number> {
    try {
        await downloadCurrentRelease()
    } catch (ex) {
        console.error(
            `Cannot download the latest release of @leanprover/infoview from NPM: ${ex instanceof Error ? ex.message : ex}`,
        )
        return 1
    }

    const formatHost: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getNewLine: () => ts.sys.newLine,
    }
    const format = (diagnostics: readonly ts.Diagnostic[]) =>
        process.stdout.isTTY
            ? ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)
            : ts.formatDiagnostics(diagnostics, formatHost)

    const config = ts.getParsedCommandLineOfConfigFile(path.join(import.meta.dirname, 'tsconfig.json'), undefined, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: diagnostic => console.error(format([diagnostic])),
    })
    if (!config) {
        return 1
    }
    const program = ts.createProgram({
        rootNames: config.fileNames,
        options: config.options,
        projectReferences: config.projectReferences,
        configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(config),
    })
    const errors = ts
        .sortAndDeduplicateDiagnostics(ts.getPreEmitDiagnostics(program))
        .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)

    const thisFile = program.getSourceFile(import.meta.filename)
    const check = thisFile?.statements.find(
        statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === breakingChangesDecl,
    )
    if (!check) {
        console.error(`error: ${import.meta.filename} does not declare '${breakingChangesDecl}'`)
        return 1
    }
    const isBreakingChange = (diagnostic: ts.Diagnostic) =>
        diagnostic.file === thisFile &&
        diagnostic.start !== undefined &&
        check.pos <= diagnostic.start &&
        diagnostic.start < check.end

    const next = await readVersion(path.join(import.meta.dirname, '..', 'package.json'))
    const current = await readVersion(path.join(currentReleaseDir, 'package.json'))
    const firstBreaking = firstBreakingVersion(parseVersion(current)).join('.')
    const breakingChangesPermitted = versionIsAtLeast(parseVersion(next), parseVersion(firstBreaking))

    if (errors.length > 0) {
        process.stdout.write(format(errors))
    }

    const hasBreakingChanges = errors.some(isBreakingChange)
    const failures = errors.filter(error => !isBreakingChange(error))

    if (failures.length > 0) {
        console.error(
            `\nThis test is broken: ${import.meta.filename} has errors outside of \`${breakingChangesDecl}\`. ` +
                'Fix them first.',
        )
        return 1
    } else if (hasBreakingChanges && !breakingChangesPermitted) {
        console.error(
            [
                `\nThe working directory has breaking changes relative to the latest NPM release of @leanprover/infoview (${current}), ` +
                    `but its version (${next}) is not semver-breaking relative to the release. ` +
                    'Breaking changes are reported above.',
                `1. Bump lean4-infoview/package.json to version ${firstBreaking}. ` +
                    'Doing so will cause this test to pass.',
                '2. When your changes are finalized and merged, publish the new release on NPM.',
                '3. Alternatively, if breaking changes were not intended, roll them back and keep the current version.'
            ].join('\n'),
        )
    } else if (hasBreakingChanges) {
        console.log(
            `\nThe working directory has breaking changes relative to the latest NPM release of @leanprover/infoview (${current}), ` +
            `and its version (${next}) is semver-breaking relative to the release.`,
            'This is permitted.',
            'Once the changes are reviewed and merged, publish the new release to NPM.'
        )
    }
    return 0
}

process.exitCode = await main()
