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
					use: ['style-loader', 'css-loader']
				},
				{
					test: /\.svg/,
					use: ['svg-inline-loader']
				}
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

module.exports =  function(env) {
	env = env || {};
	env.production = !!env.production;
	return [getWebviewConfig(env)];
};