import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { initLean4Untitled, initLean4, waitForInfoviewHtml, closeAllEditors,
	extractPhrase, restartLeanServer, assertStringInInfoview, resetToolchain, getAltBuildVersion } from '../utils/helpers';
import { logger } from '../../../src/utils/logger'

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Toolchain Test Suite', () => {

	test('Untitled Select Toolchain', async () => {

		logger.log('=================== Untitled Select Toolchain ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const lean = await initLean4Untitled('#eval Lean.versionString');
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		// wait for infoView to show up.
		await assertStringInInfoview(info, 'All Messages');

		await resetToolchain(lean.exports.clientProvider);

		await assertStringInInfoview(info, '4.0.0-nightly-');

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		const version = getAltBuildVersion()
		await vscode.commands.executeCommand('lean4.selectToolchain', `leanprover/lean4:${version}`);
		await assertStringInInfoview(info, version);

		await resetToolchain(lean.exports.clientProvider);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

	}).timeout(60000);

	test('Restart Server', async () => {

		logger.log('=================== Test Restart Server ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// Test we can restart the lean server

		// run this code twice to ensure that it still works after a Restart Server
		for (let i = 0; i < 2; i++) {

			const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
			const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

			const info = lean.exports.infoProvider;
			assert(info, 'No InfoProvider export');
			const expectedVersion = 'Hello:';
			const html = await waitForInfoviewHtml(info, expectedVersion);
			const versionString = extractPhrase(html, 'Hello:', '<').trim();
			logger.log(`>>> Found "${versionString}" in infoview`);

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
			await closeAllEditors();
		}
	}).timeout(60000);

	test('Select toolchain', async () => {
		logger.log('=================== Test select toolchain ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

		// verify we have a nightly build running in this folder.
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		const expectedVersion = '4.0.0-nightly-';
		const html = await waitForInfoviewHtml(info, expectedVersion);
        const foundVersion = extractPhrase(html, expectedVersion, '\n')

		await resetToolchain(lean.exports.clientProvider);

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		const version = getAltBuildVersion()
		await vscode.commands.executeCommand('lean4.selectToolchain', `leanprover/lean4:${version}`);

		// verify that we switched to different version
		await waitForInfoviewHtml(info, version);

		// Now reset the toolchain back to nightly build.
		await resetToolchain(lean.exports.clientProvider);

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForInfoviewHtml(info, foundVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();
	}).timeout(60000);

	test('Edit lean-toolchain version', async () => {

		logger.log('=================== Test lean-toolchain edits ===================');

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');

		const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

		// turn off the user prompts so restart of lean server happens automatically.
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		const installer = lean.exports.installer;
        assert(installer, 'No LeanInstaller export');
		installer.setPromptUser(false);

		// wait for info view to show up.
		await assertStringInInfoview(info, 'Hello');

		// Now make sure the toolchain is reset (in case previous test failed).
		await resetToolchain(lean.exports.clientProvider);

		// verify we have a nightly build running in this folder.
		const expectedVersion = '4.0.0-nightly-';
		const html = await waitForInfoviewHtml(info, expectedVersion);
        const foundVersion = extractPhrase(html, expectedVersion, '\n')

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim() === 'leanprover/lean4:nightly');

		// Switch to a alternate version by editing the toolchain file
		const version = getAltBuildVersion()
		fs.writeFileSync(toolchainFile, `leanprover/lean4:${version}`);

		try {
			// verify that we switched to alt version
			const html = await assertStringInInfoview(info, version);

			// check the path to lean.exe from the `eval IO.appPath`
			const leanPath = extractPhrase(html, 'FilePath.mk', '<').trim();
			logger.log(`Found LeanPath: ${leanPath}`)
			assert(leanPath.indexOf(version), `Lean Path does not contain: ${version}`);

			// Find out if we have a 'master' toolchain (setup by the bootstrap test)
			// and use it if it is there
			const toolChains = await installer.elanListToolChains(null);
			const masterToolChain = toolChains.find(tc => tc === 'master');
			if (masterToolChain) {
				// Switch to a linked toolchain version (setup in our workflow: on-push.yml)
				fs.writeFileSync(toolchainFile, masterToolChain);
				// verify that we switched to the master toolchain.
				await assertStringInInfoview(info, 'master');
			}

		} finally {
			// make sure we always switch back to original version!
			fs.writeFileSync(toolchainFile, originalContents);
		}

		// Now make sure the reset works and we can go back to the previous nightly version.
		await assertStringInInfoview(info, foundVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

	}).timeout(60000);

}).timeout(60000);
