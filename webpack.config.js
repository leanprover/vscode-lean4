/* [note] modified from github.com/microsoft/vscode-pull-request-github MIT licenced*/

const path = require('path');
const webpack = require('webpack');

function getWebviewConfig(env) {
	let webview = {
		name: 'webview',
		mode: env.production ? 'production' : 'development',
		entry: {
			index: './infoview/index.tsx'
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/
				},
				{
					test: /\.css/,
					use: [{
						loader: 'style-loader',
						options: {
							// copied from https://webpack.js.org/loaders/style-loader/#insert
							// makes sure that the styles are inserted at the top of the head object instead of the default behaviour at the bottom.
							insert: function insertAtTop(element) {
								var parent = document.querySelector('head');
								// eslint-disable-next-line no-underscore-dangle
								var lastInsertedElement =
									window._lastElementInsertedByStyleLoader;

								if (!lastInsertedElement) {
									parent.insertBefore(element, parent.firstChild);
								} else if (lastInsertedElement.nextSibling) {
									parent.insertBefore(element, lastInsertedElement.nextSibling);
								} else {
									parent.appendChild(element);
								}

								// eslint-disable-next-line no-underscore-dangle
								window._lastElementInsertedByStyleLoader = element;
							},
						},
					}, 'css-loader']
				},
				{
					test: /\.svg/,
					use: ['svg-loader']
				},
				{
					test: /\.(woff|woff2|ttf)$/,
					use: {
					  loader: 'url-loader',
					},
				},
			]
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js', '.svg']
		},
		devtool: !env.production ? 'inline-source-map' : undefined,
		output: {
			filename: '[name].js',
			path: path.resolve(__dirname, 'media')
		},
		plugins: [
			new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
		]
	};

	return webview;
}

function getExtensionConfig(env) {
	let config = {
		name: 'extension',
		mode: env.production ? 'production' : 'development',
		target: 'node',
		entry: {
			extension: './src/extension.ts'
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/
				}
			]
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			alias: {
				"node-fetch": path.resolve(__dirname, 'node_modules/node-fetch/lib/index.js'),
			}
		},
		devtool: !env.production ? 'source-map' : undefined,
		output: {
			filename: '[name].js',
			path: path.resolve(__dirname, 'out'),
			libraryTarget: "commonjs",
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