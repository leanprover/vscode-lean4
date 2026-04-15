import { execFileSync } from 'node:child_process'

// Point git at empty global/system config files so the developer's
// `~/.gitconfig` / `/etc/gitconfig` doesn't bleed into test fixture commits.
// In particular: `commit.gpgsign = true` (every commit tries to GPG-sign;
// fails if no agent / no key) and `core.hooksPath` (team-shared pre-commit
// hooks fire on fixture commits and either fail or hang on input). Local
// config that the test sets via `git config user.email …` etc. still works
// because that lives in the repo's own `.git/config`. Requires git ≥ 2.32.
const ISOLATED_GIT_ENV: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
}

// Runs `git` in `cwd` with the given args. stdio piped so stderr is captured
// in the thrown error rather than flooding test output on failure.
export function git(cwd: string, ...args: string[]): Buffer {
    return execFileSync('git', args, { cwd, env: ISOLATED_GIT_ENV, stdio: 'pipe' })
}

// Same as `git` but returns stdout decoded as UTF-8. Convenient for reading
// `git log` / `git config --get` output.
export function gitText(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, env: ISOLATED_GIT_ENV, encoding: 'utf8' })
}

// Initializes a fresh repo in `dir` on the `main` branch, records an author,
// stages everything, and makes an initial commit. Centralizes the identity
// fields so tests don't re-specify them and so `user.email`/`user.name` stay
// clearly distinct from the developer's real config.
export function initGitRepo(dir: string): void {
    git(dir, 'init', '-b', 'main')
    git(dir, 'config', 'user.email', 'test@example.invalid')
    git(dir, 'config', 'user.name', 'Test')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'Initial commit')
}
