import { defineConfig } from 'vitest/config'

// Vitest runs every pure-TypeScript test across the monorepo: standalone packages
// and the vscode-free modules inside vscode-lean4. Anything importing `vscode`
// belongs in the integration test suite (vscode-lean4/test/{vscode-test-cli,wdio,nightly})
// and must NOT be matched here.
//
// `lean4-infoview/test/` is deliberately absent from `include`: it holds
// `breaking.ts`, an API-shape compile check run by the package's own
// `npm test` (a `tsc -p test/tsconfig.json` invocation). It is not a vitest
// test and the filename intentionally omits the `.test.` segment so a
// broadened glob can't pick it up.
//
// `lean4-unicode-input-component/test/` has no files today (the unicode logic
// is exercised via `lean4-unicode-input`'s tests). The glob is reserved so
// future component-level tests are auto-discovered without a config edit.
export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'lean4-unicode-input/test/**/*.test.ts',
            'lean4-unicode-input-component/test/**/*.test.ts',
            'lean4-infoview-api/test/**/*.test.ts',
            'vscode-lean4/test/unit/**/*.test.ts',
        ],
        reporters: ['default'],
    },
})
