import 'es-module-shims';

import type { renderInfoview } from './index';

/**
 * Dynamically load the infoview module, execute `renderInfoview` with the provided `args`,
 * and pass its return value to `next`. See `README.md` for why this is needed.
 *
 * @param imports is the `imports` section of an [`importmap`](https://github.com/WICG/import-maps).
 * It must contain URLs for `@leanprover/infoview`, `react`, `react/jsx-runtime`, `react-dom`,
 * It may include additional URLs. The listed libraries become `import`able
 * from user widgets. Note that `dist/` already includes these files, so the following works:
 * ```js
 * {
 * '@leanprover/infoview': 'https://unpkg.com/@leanprover/infoview/dist/index.production.min.js',
 * 'react': 'https://unpkg.com/@leanprover/infoview/dist/react.production.min.js',
 * 'react/jsx-runtime': 'https://unpkg.com/@leanprover/infoview/dist/react-jsx-runtime.production.min.js',
 * 'react-dom': 'https://unpkg.com/@leanprover/infoview/dist/react-dom.production.min.js',
 * }
 * ```
 */
export function loadRenderInfoview(imports: Record<string, string>,
        args: Parameters<typeof renderInfoview>,
        next: (_: ReturnType<typeof renderInfoview>) => void) {
    importShim.addImportMap({ imports })
    importShim('@leanprover/infoview')
        .then((mod: any) => next(mod.renderInfoview(...args)))
        .catch(ex => console.error(`Error importing '@leanprover/infoview': ${JSON.stringify(ex)}`))
}
