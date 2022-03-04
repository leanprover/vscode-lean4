import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString,
	extractPhrase, restartLeanServer, assertStringInInfoview } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { LeanClientProvider} from '../../../src/utils/clientProvider';
import { LeanInstaller } from '../../../src/utils/leanInstaller';

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Toolchain Test Suite', () => {

	test('Untitled Select Toolchain', async () => {

		 console.log('=================== Untitled Select Toolchain ===================');

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

		let editor = await waitForActiveEditor();
		// make it a lean4 document even though it is empty and untitled.
		console.log('Setting lean4 language on untitled doc');
		await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(0, 0), '#eval Lean.versionString');
		});

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');

        console.log(`Found lean package version: ${lean.packageJSON.version}`);
		const info = lean.exports.infoProvider as InfoProvider;

		// If info view opens too quickly there is no LeanClient ready yet and
		// it's initialization gets messed up.
		assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 60 seconds');

		await assertStringInInfoview(info, '4.0.0-nightly-');

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		await assertStringInInfoview(info, '4.0.0, commit-');

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	}).timeout(60000);

	test('Restart Server', async () => {

		console.log('=================== Test Restart Server ===================');

		// Test we can restart the lean server
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		// run this code twice to ensure that it still works after a Restart Server
		for (let i = 0; i < 2; i++) {

			const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
			const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
			await vscode.window.showTextDocument(doc);

			const lean = await waitForActiveExtension('leanprover.lean4');
			assert(lean, 'Lean extension not loaded');
			assert(lean.exports.isLean4Project);
			assert(lean.isActive);
			console.log(`Found lean package version: ${lean.packageJSON.version}`);

			const editor = await waitForActiveEditor('Main.lean');

			const info = lean.exports.infoProvider as InfoProvider;
			assert(await waitForInfoViewOpen(info, 60),
				'Info view did not open after 20 seconds');

			let expectedVersion = 'Hello:';
			let html = await waitForHtmlString(info, expectedVersion);
			const versionString = extractPhrase(html, 'Hello:', '<').trim();
			console.log(`>>> Found "${versionString}" in infoview`);

			// Now invoke the restart server command
			const clients = lean.exports.clientProvider as LeanClientProvider;
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
		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(lean.exports.isLean4Project);
		assert(lean.isActive);
        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		await waitForActiveEditor('Main.lean');

		// Now make sure the toolchain is reset (in case previous test failed).
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		// verify we have a nightly build running in this folder.
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now switch toolchains (simple suite uses leanprover/lean4:nightly by default)
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		// verify that we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now reset the toolchain back to nightly build.
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	}).timeout(60000);

	test('Edit lean-toolchain version', async () => {

		console.log('=================== Test lean-toolchain edits ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(lean.exports.isLean4Project);
		assert(lean.isActive);
        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		await waitForActiveEditor('Main.lean');

		// Now make sure the toolchain is reset (in case previous test failed).
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		// turn off the user prompts so restart of lean server happens automatically.
		const installer = lean.exports.installer as LeanInstaller;
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
