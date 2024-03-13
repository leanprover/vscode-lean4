import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../../../src/utils/logger'
import { initLean4Untitled, initLean4, waitForInfoviewHtml, closeAllEditors, waitForActiveClient, getAltBuildVersion,
	extractPhrase, restartLeanServer, restartFile, assertStringInInfoview, insertText, deleteAllText } from '../utils/helpers';

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Toolchain Test Suite', () => {

	test('Edit lean-toolchain version', async () => {

		logger.log('=================== Edit lean-toolchain version ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');

		const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

		// turn off the user prompts so restart of lean server happens automatically.
		const info = lean.exports.infoProvider;
		assert(info, 'No InfoProvider export');
		const installer = lean.exports.installer;
        assert(installer, 'No LeanInstaller export');

		// wait for info view to show up.
		await assertStringInInfoview(info, 'Hello');

		// verify we have a nightly build running in this folder.
		const expectedVersion = '4.0.0-nightly-';
		const html = await waitForInfoviewHtml(info, expectedVersion);
        const foundVersion = extractPhrase(html, expectedVersion, '\n')

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim().startsWith('leanprover/lean4:nightly'));

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
