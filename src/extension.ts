/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { workspace, commands, window, languages, ExtensionContext } from 'vscode';
import * as translations from '../translations.json';
import { inputModeLanguages, LeanInputAbbreviator, LeanInputExplanationHover } from './input';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient';

function binPath(): string {
	return workspace.getConfiguration('lean4').get('binPath', 'lean');
}

function serverLoggingEnabled(): boolean {
	return workspace.getConfiguration('lean4.serverLogging').get('enabled', false);
}

function serverLoggingPath(): string {
	return workspace.getConfiguration('lean4.serverLogging').get('path', '.');
}

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// Register support for unicode input.
	const inputLanguages: string[] = inputModeLanguages();
	const hoverProvider =
		languages.registerHoverProvider(inputLanguages, new LeanInputExplanationHover(translations));
	context.subscriptions.push(
		hoverProvider,
		new LeanInputAbbreviator(translations));

	let serverOptions: ServerOptions = {
		command: binPath(),
		args: ["--server"],
		options: {
			shell: true,
			env: { ...process.env }
		}
	};
	if (serverLoggingEnabled()) {
		serverOptions.options.env["LEAN_SERVER_LOG_DIR"] = serverLoggingPath()
	}

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'lean4' }]
	};

	client = new LanguageClient(
		'lean4',
		'Lean 4',
		serverOptions,
		clientOptions
	);

	context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
		const editor = window.activeTextEditor;
		if (!editor) { return; }
		let doc = editor.document;
		let uri = doc.uri.toString();
		client.sendNotification("textDocument/didClose", {
			"textDocument": {
				"uri": uri
			}
		});
		client.sendNotification("textDocument/didOpen", {
			"textDocument": {
				"uri": uri,
				"languageId": "lean4",
				"version": 1,
				"text": doc.getText()
			}
		})
	}));

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
