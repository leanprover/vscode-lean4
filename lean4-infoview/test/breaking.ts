/**
 * Tests for breaking changes in the infoview API relative to the latest NPM release. If this file
 * fails to compile, indicating that there possibly was a breaking change, the two options are
 * undoing the breaking change or making a new major release. To do the latter, the procedure is:
 * 1. Ensure that `CheckSelfCompatible` below does not have errors. If it does, the test itself
 * is broken.
 * 2. Bump the major version in `lean4-infoview/package.json` and publish the new release on NPM.
 * 3. Point the `current-release` dependency at the new major version on NPM. Rerun the test
 *    and ensure that it now compiles.
 *
 * @module
 */

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
  [T] extends [number] ? T :
  T extends string ? T :
  T extends boolean ? T :
  T extends bigint ? T :
  T extends symbol ? T :
  T extends undefined ? T :
  T extends null ? T :
  T extends Promise<infer U> ? Promise<Recordify<U>>:
  T extends (...args: infer As) => infer R ? (..._: Recordify<As>) => Recordify<R> :
  T extends abstract new (...args: infer As) => infer R ? new (..._: Recordify<As>) => Recordify<R> :
  { [P in keyof T]: Recordify<T[P]> }

/** Compile-time error unless the first type extends the second. */
type CheckExtends<T extends F, F> = never

// Sanity checks
type CheckAny = CheckExtends<any, Recordify<any>>
type CheckNumber = CheckExtends<number, Recordify<number>>
type CheckString = CheckExtends<string, Recordify<string>>
type CheckBoolean = CheckExtends<boolean, Recordify<boolean>>
type CheckPromise<T> = CheckExtends<Promise<Recordify<T>>, Recordify<Promise<T>>>
type CheckArray<T> = CheckExtends<Recordify<T>[], Recordify<T[]>>
declare class Foo { private x: number }
declare class Bar { private x: number }
type CheckPrivate = CheckExtends<typeof Foo, Recordify<typeof Bar>>
declare class Baz extends Bar { y: number }
type CheckCovariant = CheckExtends<(_: any) => Baz, Recordify<(_: any) => Bar>>
type CheckContravariant = CheckExtends<Recordify<(_: Bar) => any>, (_: Baz) => any>

type CurrentRelease = typeof import('current-release')
type NextRelease = typeof import('../src/index')

/**
 * Ensures that the test isn't broken. The codebase should always be compatible with itself.
 */
type CheckSelfCompatible =
  CheckExtends<
    Recordify<Pick<CurrentRelease, keyof CurrentRelease>>,
    Recordify<CurrentRelease>> |
  CheckExtends<
    Recordify<Pick<NextRelease, keyof NextRelease>>,
    Recordify<NextRelease>>

/**
 * Compile-time error if the current version makes any breaking changes relative to the latest release.
 * Otherwise this should typecheck. The printed error may be somewhat inscrutable but should point
 * at the source of incompatibility.
 * From https://stackoverflow.com/a/71618156
 * and https://lostintime.dev/2021/01/02/typescript-api-breaking-changes.html
 */
type CheckNoBreakingChanges = CheckExtends<
  Recordify<Pick<NextRelease, keyof CurrentRelease>>,
  Recordify<CurrentRelease>>
