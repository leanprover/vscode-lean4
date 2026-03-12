import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import url from '@rollup/plugin-url'
import fs from 'fs'
import path from 'path'
import css from 'rollup-plugin-css-only'

/**
 * A minimal Rollup plugin that loads existing source maps for `.js` files.
 * When Rollup imports an already-compiled `.js` file (e.g. from `lean4-infoview-api/dist`),
 * it does not read the accompanying `.js.map` by default.
 * This plugin checks for a sibling `.map` file and, if found,
 * returns its contents from the `load` hook so that Rollup chains the maps together.
 * This allows the final bundle's source map to point to the original `.ts` sources
 * rather than the intermediate `.js` files.
 *
 * @returns {import('rollup').Plugin} */
const inputSourcemaps = () => ({
    name: 'input-sourcemaps',
    async load(id) {
        if (!id.endsWith('.js')) return null

        let code = ''
        let map = {}
        try {
            code = await fs.promises.readFile(id, 'utf8')
            const mapJson = await fs.promises.readFile(id + '.map', 'utf8')
            map = JSON.parse(mapJson)
        } catch {
            return null
        }

        // Skip this sourcemap if any source is inaccessible.
        if (!map.sources) return null
        const srcDir = path.dirname(id)
        for (const s of map.sources) {
            try {
                const pathAbs = path.resolve(srcDir, s)
                await fs.promises.access(pathAbs)
            } catch {
                return null
            }
        }

        // React to changes to the source file in watch mode.
        this.addWatchFile(id)
        return { code, map }
    },
})

/** @type {import('rollup').OutputOptions} */
const output =
    process.env.NODE_ENV && process.env.NODE_ENV === 'production'
        ? {
              dir: 'dist',
              sourcemap: false,
              format: 'esm',
              compact: true,
              entryFileNames: '[name].production.min.js',
              chunkFileNames: '[name]-[hash].production.min.js',
              plugins: [terser()],
          }
        : {
              dir: 'dist',
              sourcemap: true,
              /* By default, `sourceMappingURL` in the infoview bundle (`dist/index.development.js`)
               * points to the source map as a relative path.
               * When we debug the webview,
               * the infoview bundle is fetched from VSCode's builtin `vscode-resource` server,
               * and Chrome DevTools tries to fetch the source map that way as well.
               * This fails,
               * despite `WebviewOptions.localResourceRoots` supposedly including the entire workspace by default.
               * Using a `file://` URI instead allows DevTools to fetch the source map,
               * as well as all the source files it refers to. */
              sourcemapBaseUrl: 'file://' + path.resolve('dist'),
              /* Source maps refer to relative paths by default,
               * but these paths get broken when lean4-infoview/dist is copied into vscode-lean4/dist.
               * Make them absolute instead. */
              sourcemapPathTransform: (relativeSourcePath, sourcemapPath) =>
                  path.resolve(path.dirname(sourcemapPath), relativeSourcePath),
              format: 'esm',
              entryFileNames: '[name].development.js',
              chunkFileNames: '[name]-[hash].development.js',
          }

/** @type {import('rollup').InputPluginOption} */
const plugins = [
    inputSourcemaps(),
    url({
        include: ['**/*.ttf'],
        fileName: '[name][extname]',
    }),
    typescript({
        tsconfig: './tsconfig.json',
        outputToFilesystem: false,
    }),
    nodeResolve({
        browser: true,
    }),
    replace({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true,
    }),
    commonjs(),
    json(),
]

/**
 * Besides building the infoview single-page application,
 * we build a loader and a bunch of esm-shims.
 * This is a way of compiling our runtime dependencies into single-file ES modules
 * which can be shared as imports between the infoview app and dynamically loaded widget modules.
 * Due to limitations in Rollup,
 * we must use an array of configs rather than a single config to do this.
 * Although projects do exist (e.g. jspm.io)
 * that could in principle produce the esm-shims for us,
 * they tend to chunk modules into many files rather than producing a single file.
 * Requiring them dynamically would make the infoview depend on an internet connection.
 * See also `README.md`.
 *
 * @type {import('rollup').RollupOptions[]}
 */
const configs = [
    {
        output,
        plugins: plugins.concat([
            css({
                output: 'index.css',
            }),
        ]),
        input: 'src/index.tsx',
        external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    {
        output: {
            ...output,
            // Put `es-module-shims` in shim mode, needed to support dynamic `import`s.
            // This code has to be set before `es-module-shims` is loaded,
            // so we put it in the Rollup intro.
            intro: 'window.esmsInitOptions = { shimMode: true }',
        },
        plugins,
        input: 'src/loader.ts',
    },
    {
        output,
        plugins,
        input: 'src/esm-shims/react.ts',
    },
    {
        output,
        plugins,
        input: 'src/esm-shims/react-dom.ts',
        external: ['react'],
    },
    {
        output,
        plugins,
        input: 'src/esm-shims/react-jsx-runtime.ts',
        external: ['react'],
    },
]

export default configs
