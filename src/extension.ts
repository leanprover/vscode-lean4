/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { languages, ExtensionContext } from 'vscode';
import loadJsonFile = require('load-json-file');
import { inputModeLanguages, LeanInputAbbreviator, LeanInputExplanationHover } from './input';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// Register support for unicode input.
    void (async () => {
        const translations: any = await loadJsonFile(context.asAbsolutePath('translations.json'));
        const inputLanguages: string[] = inputModeLanguages();
        const hoverProvider =
            languages.registerHoverProvider(inputLanguages, new LeanInputExplanationHover(translations));
        context.subscriptions.push(
            hoverProvider,
            new LeanInputAbbreviator(translations));
    })();

	// TODO: Load these from config
	let serverOptions: ServerOptions = {
		command: "$LEAN4_HOME/build/$RELEASE_OR_DEBUG/stage1/bin/lean/",
		args: ["--server"],
		options: {
		  env: {
			LEAN_PATH: "$LEAN4_HOME/build/$RELEASE_OR_DEBUG/stage1/lib/lean/",
			// Set to use a different Lean binary for the worker
			//, LEAN_WORKER_PATH: "$LEAN4_HOME/build/$RELEASE_OR_DEBUG/stage1/bin/lean"
			// Add this to log LSP messages to a folder
			// LEAN_SERVER_LOG_DIR: "my/log/dir"
		  }
		}
	  };

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'lean4' }]
	};

	client = new LanguageClient(
		'lean4',
		'Lean 4 LSP client',
		serverOptions,
		clientOptions
	);

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
