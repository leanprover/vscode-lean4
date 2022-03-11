/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

const prodOrDev = (env) => env.production ? 'production' : 'development';
const minIfProd = (env) => env.production ? '.min' : '';

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
		devtool: !env.production ? 'inline-source-map' : undefined,
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
					from: path.resolve(__dirname, 'node_modules', '@lean4', 'infoview', 'dist'),
					to: path.resolve(__dirname, 'dist', 'lean4-infoview')
				}, {
					from: path.resolve(__dirname, 'node_modules', '@esm-bundle', 'react', 'esm', `react.${prodOrDev(env)}${minIfProd(env)}.js`),
					to: path.resolve(__dirname, 'dist', 'react.js')
				}, {
					from: path.resolve(__dirname, 'node_modules', '@esm-bundle', 'react-dom', 'esm', `react-dom.${prodOrDev(env)}${minIfProd(env)}.js`),
					to: path.resolve(__dirname, 'dist', 'react-dom.js')
				}]
			})
		]
	};

	return webview;
}

function getExtensionConfig(env) {
	let config = {
		name: 'extension',
		mode: env.production ? 'production' : 'development',
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
		devtool: !env.production ? 'source-map' : undefined,
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
