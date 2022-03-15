import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { initLean4Untitled, initLean4, waitForHtmlString,
	extractPhrase, restartLeanServer, assertStringInInfoview, resetToolchain, sleep } from '../utils/helpers';

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Toolchain Test Suite', () => {

	test('Untitled Select Toolchain', async () => {

		console.log('=================== Untitled Select Toolchain ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const lean = await initLean4Untitled('#eval Lean.versionString');
		await resetToolchain();

		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');

		await assertStringInInfoview(info, '4.0.0-nightly-');

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		await assertStringInInfoview(info, '4.0.0, commit');

		await resetToolchain();

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	}).timeout(60000);

	test('Restart Server', async () => {

		console.log('=================== Test Restart Server ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// Test we can restart the lean server

		// run this code twice to ensure that it still works after a Restart Server
		for (let i = 0; i < 2; i++) {

			const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
			const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

			const info = lean.exports.infoProvider;
			assert(info, 'No InfoProvider export');
			const expectedVersion = 'Hello:';
			const html = await waitForHtmlString(info, expectedVersion);
			const versionString = extractPhrase(html, 'Hello:', '<').trim();
			console.log(`>>> Found "${versionString}" in infoview`);

			// Now invoke the restart server command
			const clients = lean.exports.clientProvider;
			assert(clients, 'No LeanClientProvider export');
			const client = clients.getClientForFolder(vscode.Uri.file(testsRoot));
			if (client) {
				await restartLeanServer(client);
			} else {
				assert(false, 'No LeanClient found for folder');
			}

			// make sure test is always run in predictable state, which is no file or folder open
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	}).timeout(60000);

	test('Select toolchain', async () => {
		console.log('=================== Test select toolchain ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const lean = await initLean4(path.join(testsRoot, 'Main.lean'));
		await resetToolchain();
		// verify we have a nightly build running in this folder.
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		const expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		// verify that we switched to leanprover/lean4:stable
		const expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now reset the toolchain back to nightly build.
		await resetToolchain();

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	}).timeout(60000);

	test('Edit lean-toolchain version', async () => {

		console.log('=================== Test lean-toolchain edits ===================');

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');

		const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

		// Now make sure the toolchain is reset (in case previous test failed).
		await resetToolchain();
		// turn off the user prompts so restart of lean server happens automatically.
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		const installer = lean.exports.installer;
        assert(installer, 'No LeanInstaller export');
		installer.setPromptUser(false);

		// verify we have a nightly build running in this folder.
		await assertStringInInfoview(info, '4.0.0-nightly-');

		// Find out if we have a 'master' toolchain (setup in our workflow: on-push.yml)
		// and use it if it is there, otherwise use 'leanprover/lean4:stable'.
		const toolChains = await installer.elanListToolChains(null);
		const masterToolChain = toolChains.find(tc => tc === 'master');
		const selectedToolChain = masterToolChain ?? 'leanprover/lean4:stable';
		const expectedToolChain = masterToolChain ? 'master' : 'stable';

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim() === 'leanprover/lean4:nightly');
		// Switch to a linked toolchain version (setup in our workflow: on-push.yml)
		fs.writeFileSync(toolchainFile, selectedToolChain);

		// verify that we switched to leanprover/lean4:stable
		const html = await assertStringInInfoview(info, '4.0.0, commit');

		// check the path to lean.exe from the `eval IO.appPath`
		const leanPath = extractPhrase(html, 'FilePath.mk', '<').trim();
		console.log(`Found LeanPath: ${leanPath}`)
		assert(leanPath.indexOf(expectedToolChain), `Lean Path does not contain ${expectedToolChain}`);

		// Switch back to original version.
		fs.writeFileSync(toolchainFile, originalContents);

		// Now make sure the reset works and we can go back to the previous nightly version.
		await assertStringInInfoview(info, '4.0.0-nightly-');

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	}).timeout(60000);

}).timeout(60000);
