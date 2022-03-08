/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

function getWebviewConfig(env) {
	let webview = {
		name: 'webview',
		mode: env.production ? 'production' : 'development',
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
		output: {
			filename: 'webview.js',
			path: path.resolve(__dirname, 'dist'),
			library: {
				name: 'webview',
				type: 'amd'
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
				patterns: [
					{
						from: path.resolve(__dirname, 'node_modules', '@lean4', 'infoview', 'dist', 'index.js'),
						to: path.resolve(__dirname, 'dist', 'lean4-infoview.js')
					},
					{
						from: path.resolve(__dirname, 'node_modules', 'react', 'umd', 'react.production.min.js'),
						to: path.resolve(__dirname, 'dist', 'react.js')
					},
					{
						from: path.resolve(__dirname, 'node_modules', 'react-dom', 'umd', 'react-dom.production.min.js'),
						to: path.resolve(__dirname, 'dist', 'react-dom.js')
					},
					{
						from: path.resolve(__dirname, 'node_modules', 'react-popper', 'dist', 'index.umd.min.js'),
						to: path.resolve(__dirname, 'dist', 'react-popper.js')
					},
					{
						from: path.resolve(__dirname, 'node_modules', '@popperjs', 'core', 'dist', 'umd', 'popper.min.js'),
						to: path.resolve(__dirname, 'dist', 'popperjs-core.js')
					},
					{
						from: path.resolve(__dirname, 'node_modules', 'requirejs', 'require.js'),
						to: path.resolve(__dirname, 'dist', 'require.js')
					}
				]
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
