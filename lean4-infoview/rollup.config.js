import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import url from '@rollup/plugin-url';
import css from 'rollup-plugin-css-only';
import { terser } from 'rollup-plugin-terser';

const output = process.env.NODE_ENV && process.env.NODE_ENV === 'production' ?  {
        dir: 'dist',
        sourcemap: false,
        format: 'esm',
        compact: true,
        entryFileNames: '[name].production.min.js',
        chunkFileNames: '[name]-[hash].production.min.js',
        plugins: [
            terser()
        ]
    } : {
        dir: 'dist',
        sourcemap: 'inline',
        format: 'esm',
        entryFileNames: '[name].development.js',
        chunkFileNames: '[name]-[hash].development.js'
    }

export default {
    input: {
        'index': 'src/index.ts',
        'react-popper': 'src/react-popper.ts'
    },
    output,
    external: [
        'react',
        'react-dom'
        // TODO externalize react-popper when it gets an @esm-bundle
    ],
    plugins: [
        css({
            output: 'index.css'
        }),
        url({
            include: ['**/*.ttf'],
            fileName: '[name][extname]'
        }),
        typescript({
            tsconfig: "./tsconfig.json",
            outputToFilesystem: false,
            // https://stackoverflow.com/a/63235210
            sourceMap: false        
        }),
        nodeResolve({
            browser: true
        }),
        replace({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
            preventAssignment: true // TODO delete when `true` becomes the default
        }),
        commonjs()
    ]
};
