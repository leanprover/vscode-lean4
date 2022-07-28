import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../../../src/utils/logger'
import { initLean4Untitled, initLean4, waitForInfoviewHtml, closeAllEditors, assertActiveClient, getAltBuildVersion,
	extractPhrase, restartLeanServer, restartFile, assertStringInInfoview, resetToolchain, insertText, deleteAllText } from '../utils/helpers';

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Toolchain Test Suite', () => {

	test('Untitled Select Toolchain', async () => {

		logger.log('=================== Untitled Select Toolchain ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const lean = await initLean4Untitled('#eval Lean.versionString');
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');

		logger.log('wait for infoView to show up with 4.0.0-nightly-');
		await assertStringInInfoview(info, 'All Messages');
		const expectedVersion = '4.0.0-nightly-'
		const html = await waitForInfoviewHtml(info, expectedVersion);
        const foundVersion = extractPhrase(html, expectedVersion, '\n')

		try {
			const version = getAltBuildVersion()
			logger.log(`Now switch toolchains to leanprover/lean4:${version}`);
			await vscode.commands.executeCommand('lean4.selectToolchain', `leanprover/lean4:${version}`);
			await assertStringInInfoview(info, version);
		} finally {
			logger.log(`Resetting toolchain override and waiting for ${foundVersion}`);
			await resetToolchain(lean.exports.clientProvider);
		}
		await assertStringInInfoview(info, foundVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

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

		try {
			// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
			const version = getAltBuildVersion()
			logger.log(`Installing lean4 toolchain: leanprover/lean4:${version}`)
			await vscode.commands.executeCommand('lean4.selectToolchain', `leanprover/lean4:${version}`);

			// verify that we switched to different version
			await waitForInfoviewHtml(info, version);
		} finally {
			logger.log(`Resetting toolchain override to revert back to ${foundVersion}`);
			await resetToolchain(lean.exports.clientProvider);
		}

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForInfoviewHtml(info, foundVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();
	}).timeout(60000);

	test('Edit lean-toolchain version', async () => {

		logger.log('=================== Edit lean-toolchain version ===================');

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

		// verify we have a nightly build running in this folder.
		const expectedVersion = '4.0.0-nightly-';
		const html = await waitForInfoviewHtml(info, expectedVersion);
        const foundVersion = extractPhrase(html, expectedVersion, '\n')

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim() === 'leanprover/lean4:nightly');

		const version = getAltBuildVersion()
		logger.log(`Switch to a alternate version ${version} by editing the toolchain file`);
		fs.writeFileSync(toolchainFile, `leanprover/lean4:${version}`);

		try {
			logger.log(`verify that we switched to alt version ${version}`);
			const html = await assertStringInInfoview(info, version);

			// check the path to lean.exe from the `eval IO.appPath`
			const leanPath = extractPhrase(html, 'FilePath.mk', '<').trim();
			logger.log(`Found LeanPath: ${leanPath}`)
			assert(leanPath.indexOf(version), `Lean Path does not contain: ${version}`);

		} finally {
			// make sure we always switch back to original version!
			logger.log(`switching toolchain back to original version ${originalContents}`);
			fs.writeFileSync(toolchainFile, originalContents);
		}

		logger.log(`Wait for version to appear, it should be ${foundVersion}`);
		await assertStringInInfoview(info, foundVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await closeAllEditors();

	}).timeout(60000);


}).timeout(120000);
