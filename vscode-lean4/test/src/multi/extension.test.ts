import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString, extractPhrase,
	findLeanServers, assertLeanServers, sleep } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { LeanClientProvider} from '../../../src/utils/clientProvider';
import { LeanInstaller } from '../../../src/utils/leanInstaller';

suite('Extension Test Suite', () => {

	test('Load a multi-project workspace', async () => {

		console.log('=================== Load Lean Files in a multi-project workspace ===================');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'multi');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'test', 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(lean.exports.isLean4Project);
		assert(lean.isActive);
        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		await waitForActiveEditor('Main.lean');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		// verify we have a nightly build running in this folder.
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now open a file from the other project
		const doc2 = await vscode.workspace.openTextDocument(path.join(testsRoot, 'foo', 'Foo.lean'));
		await vscode.window.showTextDocument(doc2);

		// verify that a different version of lean is running here (leanprover/lean4:stable)
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now verify we have 2 LeanClients running.
		const clients = lean.exports.clientProvider as LeanClientProvider;
		assert(clients.getClients().length === 2, "Expected 2 LeanClients to be running");

		await sleep(1000);
		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000);

		// we opened two new folders 'multi/test' and 'multi/foo'
		await assertLeanServers( servers + 2, workers + 0);

	}).timeout(60000);

	test('Select toolchain', async () => {
		console.log('=================== Test select toolchain ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'multi');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'test', 'Main.lean'));
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

		// Now switch toolchains
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		// verify that we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now reset the toolchain back to nightly build.
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await sleep(1000);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await sleep(1000);

		// we opened nothing new in this test, but make sure select toolchain doesn't leak servers
		await assertLeanServers( servers + 0, workers + 0);
	}).timeout(60000);

	test('Edit lean-toolchain version', async () => {

		console.log('=================== Test lean-toolchain edits ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'multi');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'test', 'Main.lean'));
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
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Find out if we have a 'master' toolchain (setup in our workflow: on-push.yml)
		// and use it if it is there, otherwise use 'leanprover/lean4:stable'.
		const toolChains = await installer.elanListToolChains(null);
		const masterToolChain = toolChains.find(tc => tc === 'master');
		const selectedToolChain = masterToolChain ?? 'leanprover/lean4:stable';
		const expectedToolChain = masterToolChain ? 'master' : 'stable';

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'test', 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim() === 'leanprover/lean4:nightly');
		// Switch to a linked toolchain version (setup in our workflow: on-push.yml)
		fs.writeFileSync(toolchainFile, selectedToolChain);

		// verify that we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		let html = await waitForHtmlString(info, expected2);

		// check the path to lean.exe from the `eval IO.appPath`
		const leanPath = extractPhrase(html, 'FilePath.mk', '<').trim();
		console.log(`Found LeanPath: ${leanPath}`)
		assert(leanPath.indexOf(expectedToolChain), `Lean Path does not contain ${expectedToolChain}`);

		// Switch back to original version.
		fs.writeFileSync(toolchainFile, originalContents);

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		// we opened nothing new in this test, but make sure editing the toolchain doesn't leak servers
		await assertLeanServers( servers + 0, workers + 0);

	}).timeout(60000);


}).timeout(60000);
