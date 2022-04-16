/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

const prodOrDev = (env) => env.production ? 'production' : 'development';

function getWebviewConfig(env) {
	let webview = {
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
					enforce: "pre",
					use: ["source-map-loader"],
				},
			]
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js']
		},
		devtool: env.production ? undefined : 'inline-source-map',
		experiments: {
			outputModule: true
		},
		output: {
			filename: 'webview.js',
			path: path.resolve(__dirname, 'dist'),
			library: {
				type: 'module'
			}
		},
		externals: [
			'@lean4/infoview'
		],
		plugins: [
			new webpack.IgnorePlugin({
				resourceRegExp: /^\.\/locale$/,
				contextRegExp: /moment$/,
			}),
			new CopyPlugin({
				patterns: [{
					// See https://github.com/webpack-contrib/copy-webpack-plugin/tree/e2274daad21baae3020819aa29ab903bd9992cce#yarn-workspaces-and-monorepos
					from : `${path.dirname(require.resolve('@lean4/infoview/package.json'))}/dist`,
					to: path.resolve(__dirname, 'dist', 'lean4-infoview')
				}, {
					from: path.resolve(__dirname, 'node_modules', '@esm-bundle', 'react', 'esm'),
					to: path.resolve(__dirname, 'dist', 'react')
				}, {
					from: path.resolve(__dirname, 'node_modules', '@esm-bundle', 'react-dom', 'esm'),
					to: path.resolve(__dirname, 'dist', 'react-dom')
				}, {
					from: path.resolve(__dirname, 'media', 'es-module-shims.js'),
					to: path.resolve(__dirname, 'dist', 'es-module-shims.js')
				}]
			})
		]
	};

	return webview;
}

function getExtensionConfig(env) {
	let config = {
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
				}
			]
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			alias: {
				'node-fetch': path.resolve(__dirname, 'node_modules/node-fetch/lib/index.js'),
			}
		},
		devtool: env.production ? undefined : 'source-map',
		output: {
			filename: 'extension.js',
			path: path.resolve(__dirname, 'dist'),
			library: {
				type: 'commonjs',
			},
			devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]'
		},
		externals: {
			'vscode': 'commonjs vscode'
		}
	};
	return config;
}

module.exports = function (env) {
	env = env || {};
	env.production = !!env.production;
	return [getWebviewConfig(env), getExtensionConfig(env)];
};
