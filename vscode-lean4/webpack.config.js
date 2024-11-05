/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path')
const webpack = require('webpack')
const CopyPlugin = require('copy-webpack-plugin')

/**
 * @typedef Env
 * @prop {boolean} production
 */

/** @type {(env: Env) => 'production' | 'development'} */
const prodOrDev = env => (env.production ? 'production' : 'development')

/** @type {(env: Env) => import('webpack').Configuration} */
const getWebviewConfig = env => ({
    name: 'webview',
    mode: prodOrDev(env),
    entry: './webview/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: ['source-map-loader'],
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    devtool: env.production ? undefined : 'inline-source-map',
    output: {
        filename: 'webview.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new webpack.IgnorePlugin({
            resourceRegExp: /^\.\/locale$/,
            contextRegExp: /moment$/,
        }),
        new CopyPlugin({
            patterns: [
                {
                    // See https://github.com/webpack-contrib/copy-webpack-plugin/tree/e2274daad21baae3020819aa29ab903bd9992cce#yarn-workspaces-and-monorepos
                    from: `${path.dirname(require.resolve('@leanprover/infoview/package.json'))}/dist`,
                    to: path.resolve(__dirname, 'dist', 'lean4-infoview'),
                },
            ],
        }),
    ],
})

/** @type {(env: Env) => import('webpack').Configuration} */
const getLoogleViewConfig = env => ({
    name: 'loogleview',
    mode: prodOrDev(env),
    entry: './loogleview/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: ['source-map-loader'],
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    devtool: env.production ? undefined : 'inline-source-map',
    output: {
        filename: 'loogleview.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: './loogleview/static',
                    to: path.resolve(__dirname, 'dist', 'loogleview', 'static'),
                },
                {
                    from: '../node_modules/@vscode/codicons/dist',
                    to: path.resolve(__dirname, 'dist', 'loogleview', 'static', 'codicons'),
                },
                {
                    from: '../node_modules/@vscode-elements/elements/dist',
                    to: path.resolve(__dirname, 'dist', 'loogleview', 'static', 'elements'),
                },
            ],
        }),
    ],
})

/** @type {(env: Env) => import('webpack').Configuration} */
const getMoogleViewConfig = env => ({
    name: 'moogleview',
    mode: prodOrDev(env),
    entry: './moogleview/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: ['source-map-loader'],
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    devtool: env.production ? undefined : 'inline-source-map',
    output: {
        filename: 'moogleview.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: './moogleview/static',
                    to: path.resolve(__dirname, 'dist', 'moogleview', 'static'),
                },
                {
                    from: '../node_modules/@vscode/codicons/dist',
                    to: path.resolve(__dirname, 'dist', 'moogleview', 'static', 'codicons'),
                },
                {
                    from: '../node_modules/@vscode-elements/elements/dist',
                    to: path.resolve(__dirname, 'dist', 'moogleview', 'static', 'elements'),
                },
            ],
        }),
    ],
})

/** @type {(env: Env) => import('webpack').Configuration} */
const getAbbreviationViewConfig = env => ({
    name: 'abbreviationview',
    mode: prodOrDev(env),
    entry: './abbreviationview/index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: ['source-map-loader'],
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    devtool: env.production ? undefined : 'inline-source-map',
    output: {
        filename: 'abbreviationview.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: '../node_modules/@vscode-elements/elements/dist',
                    to: path.resolve(__dirname, 'dist', 'abbreviationview', 'static', 'elements'),
                },
            ],
        }),
    ],
})

/** @type {(env: Env) => import('webpack').Configuration} */
const getExtensionConfig = env => ({
    name: 'extension',
    mode: prodOrDev(env),
    target: 'node',
    entry: './src/extension.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    devtool: env.production ? undefined : 'source-map',
    output: {
        filename: 'extension.js',
        path: path.resolve(__dirname, 'dist'),
        library: {
            type: 'commonjs',
        },
        devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]',
    },
    externals: {
        vscode: 'commonjs vscode',
    },
})

/** @type {(env: any) => import('webpack').Configuration[]} */
module.exports = function (env) {
    env = env || {}
    env.production = !!env.production
    return [
        getWebviewConfig(env),
        getLoogleViewConfig(env),
        getMoogleViewConfig(env),
        getAbbreviationViewConfig(env),
        getExtensionConfig(env),
    ]
}
