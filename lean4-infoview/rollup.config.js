import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import url from '@rollup/plugin-url'
import css from 'rollup-plugin-css-only'

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
              sourcemap: 'inline',
              format: 'esm',
              entryFileNames: '[name].development.js',
              chunkFileNames: '[name]-[hash].development.js',
          }

/** @type {import('rollup').InputPluginOption} */
const plugins = [
    url({
        include: ['**/*.ttf'],
        fileName: '[name][extname]',
    }),
    typescript({
        tsconfig: './tsconfig.json',
        outputToFilesystem: false,
        // https://stackoverflow.com/a/63235210
        sourceMap: false,
    }),
    nodeResolve({
        browser: true,
    }),
    replace({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true, // TODO delete when `true` becomes the default
    }),
    commonjs(),
]

/**
 * Note that besides building the infoview single-page application, we build a loader and a bunch
 * of esm-shims. This is a way of compiling our dependencies into single-file ES modules which can
 * be shared as imports between the infoview app and dynamically loaded widget modules. Although
 * projects such * as jspm.io do exist, they tend to chunk modules into a bunch of files which are
 * not easy to * bundle, and requiring them dynamically would make the infoview depend on an internet
 * connection. See also `README.md`.
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
            // Put `es-module-shims` in shim mode with support for dynamic `import`
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
