/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path');
const webpack = require('webpack');

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
			path: path.resolve(__dirname, 'media')
		},
		plugins: [
			new webpack.IgnorePlugin({
				resourceRegExp: /^\.\/locale$/,
				contextRegExp: /moment$/,
			}),
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
