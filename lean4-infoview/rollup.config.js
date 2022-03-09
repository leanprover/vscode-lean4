import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import css from 'rollup-plugin-css-only';

export default {
    input: 'src/index.ts',
    output: {
        file: 'dist/index.js',
        sourcemap: true,
        format: 'esm'
    },
    plugins: [
        css({
            output: 'index.css'
        }),
        typescript({
            tsconfig: "./tsconfig.json"
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
