import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../../../src/utils/logger'
import { initLean4Untitled, initLean4, waitForInfoviewHtml, closeAllEditors, assertActiveClient, getAltBuildVersion,
	extractPhrase, restartLeanServer, restartFile, assertStringInInfoview, resetToolchain, insertText, deleteAllText } from '../utils/helpers';

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Lean Server Restart Test Suite', () => {

	test('Worker crashed and client running - Restarting Lean Server', async () => {
		logger.log('=================== Test worker crashed and client running ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// add normal values to initialize lean4 file
		const hello = 'Hello World'
		const lean = await initLean4Untitled(`#eval "${hello}"`);
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');

		logger.log('make sure language server is up and running.');
		await assertStringInInfoview(info, hello);

		const clients = lean.exports.clientProvider;
		assert(clients, 'No LeanClientProvider export');

		logger.log('Insert eval that causes crash.')
		await insertText('\n\n#eval (unsafeCast 0 : String)')

		const expectedMessage = 'The Lean Server has stopped processing this file'
		await assertStringInInfoview(info, expectedMessage);

		logger.log('restart the server (without modifying the file, so it should crash again)')
		let client = assertActiveClient(clients);
		await restartLeanServer(client);

		logger.log('Checking that it crashed again.')
		await assertStringInInfoview(info, expectedMessage);

		logger.log('deleting the problematic string closing active editors and restarting the server')
		await deleteAllText();
		await insertText(`#eval "${hello}"`);
		logger.log('Now invoke the restart server command')
		client = assertActiveClient(clients);
		await restartLeanServer(client);

		logger.log('checking that Hello World comes back after restart')
		await assertStringInInfoview(info, hello);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

	}).timeout(60000);

	test('Worker crashed and client running - Restarting File (Refreshing dependencies)', async () => {
		logger.log('=================== Test worker crashed and client running ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// add normal values to initialize lean4 file
		const hello = 'Hello World'
		const lean = await initLean4Untitled(`#eval "${hello}"`);
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');

		logger.log('make sure language server is up and running.');
		await assertStringInInfoview(info, hello);

		const clients = lean.exports.clientProvider;
		assert(clients, 'No LeanClientProvider export');

		logger.log('Insert eval that causes crash.')
		await insertText('\n\n#eval (unsafeCast 0 : String)')

		const expectedMessage = 'The Lean Server has stopped processing this file'
		await assertStringInInfoview(info, expectedMessage);

		logger.log('restart the server (without modifying the file, so it should crash again)')
		let client = assertActiveClient(clients);
		await restartFile();

		logger.log('Checking that it crashed again.')
		await assertStringInInfoview(info, expectedMessage);

		logger.log('deleting the problematic string closing active editors and restarting the server')
		await deleteAllText();
		await insertText(`#eval "${hello}"`);
		logger.log('Now invoke the restart server command')
		client = assertActiveClient(clients);
		await restartFile();

		logger.log('checking that Hello World comes back after restart')
		await assertStringInInfoview(info, hello);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

	}).timeout(60000);

	test('Restart Server', async () => {

		logger.log('=================== Test Restart Server ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// Test we can restart the lean server
		const simpleRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');

		// run this code twice to ensure that it still works after a Restart Server
		for (let i = 0; i < 2; i++) {

			const lean = await initLean4(path.join(simpleRoot, 'Main.lean'));

			const info = lean.exports.infoProvider;
			assert(info, 'No InfoProvider export');
			const expectedVersion = 'Hello:';
			const html = await waitForInfoviewHtml(info, expectedVersion);
			const versionString = extractPhrase(html, 'Hello:', '<').trim();
			logger.log(`>>> Found "${versionString}" in infoview`);

			logger.log('Now invoke the restart server command');
			const clients = lean.exports.clientProvider;
			assert(clients, 'No LeanClientProvider export');
			const client = clients.getClientForFolder(vscode.Uri.file(simpleRoot));
			if (client) {
				await restartLeanServer(client);
			} else {
				assert(false, 'No LeanClient found for folder');
			}

			// make sure test is always run in predictable state, which is no file or folder open
			await closeAllEditors();
		}
	}).timeout(60000);

}).timeout(120000);
