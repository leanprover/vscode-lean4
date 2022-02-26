import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString,
	extractPhrase, findWord, restartLeanServer, sleep, findLeanServers, assertLeanServers } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { LeanClientProvider} from '../../../src/utils/clientProvider';
import { LeanInstaller } from '../../../src/utils/leanInstaller';

suite('Extension Test Suite', () => {

	test('Untitled Lean File', async () => {

		console.log('=================== Untitled Lean File ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const [servers, workers] = await findLeanServers();

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

		assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 60 seconds');

		const expectedVersion = '4.0.0-nightly-';
		let html = await waitForHtmlString(info, expectedVersion);
		const pos = html.indexOf('4.0.0-nightly-');
		if (pos >= 0) {
			// 4.0.0-nightly-2022-02-16
			const versionString = html.substring(pos, pos + 24)
			console.log(`>>> Found "${versionString}" in infoview`)
		}

		// test goto definition to lean toolchain works

		const wordRange = findWord(editor, 'versionString');
		assert(wordRange, 'Missing versionString in Main.lean');

		// The -1 is to workaround a bug in goto definition.
		// The cursor must be placed before the end of the identifier.
		const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1);
		editor.selection = new vscode.Selection(wordRange.start, secondLastChar);

		await vscode.commands.executeCommand('editor.action.revealDefinition');

		// check infoview is working in this new editor, it should be showing the expected type
		// for the versionString function we just jumped to.
		html = await waitForHtmlString(info, 'Expected type');

		if (vscode.window.activeTextEditor) {
			editor = vscode.window.activeTextEditor
			const expected = path.join('.elan', 'toolchains', 'leanprover--lean4---nightly', 'src', 'lean');
			assert(editor.document.uri.fsPath.indexOf(expected) > 0,
				`Active text editor is not located in ${expected}`);

			// make sure lean client is started in the right place.
			const clients = lean.exports.clientProvider as LeanClientProvider;
			clients.getClients().forEach((client) => {
				const leanRoot = client.getWorkspaceFolder();
				if (leanRoot.indexOf('leanprover--lean4---nightly') > 0){
					assert(leanRoot.endsWith('leanprover--lean4---nightly'),
						'Lean client is not rooted in the \'leanprover--lean4---nightly\' folder');
				}
			});
		}

		await sleep(1000);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000);

		// after untitled, and goto definition on Lean.versionString we should have 2 additional lean --servers
		// running and we should have no additional --worker processes still running since all editors have been closed.
		await assertLeanServers( servers + 2, workers + 0);

	}).timeout(60000);

	test('Orphaned Lean File', async () => {

		console.log('=================== Orphaned Lean File ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'orphan');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'factorial.lean'));
		await vscode.window.showTextDocument(doc);

		let editor = await waitForActiveEditor();

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');

        console.log(`Found lean package version: ${lean.packageJSON.version}`);
		const info = lean.exports.infoProvider as InfoProvider;

        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 60 seconds');

		const expectedVersion = '5040';  // the factorial function works.
		let html = await waitForHtmlString(info, expectedVersion);

		const installer = lean.exports.installer as LeanInstaller;
		const toolChains = await installer.elanListToolChains(null);
		let defaultToolChain = toolChains.find(tc => tc.indexOf('default') > 0);
		if (defaultToolChain) {
			// the IO.appPath should output something like this:
			// FilePath.mk "/home/.elan/toolchains/leanprover--lean4---nightly/bin/lean.exe"
			// So let's try and find the 'leanprover--lean4---nightly' part.
			defaultToolChain = defaultToolChain.replace(' (default)', '').trim();
			defaultToolChain = defaultToolChain.replace('/','--');
			defaultToolChain = defaultToolChain.replace(':','---')
			// make sure this string exists in the info view.
			await waitForHtmlString(info, defaultToolChain);
		}

		await sleep(1000);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000);

		// we should have one more server for the 'orphan' folder.
		await assertLeanServers(servers + 1, workers + 0);

	}).timeout(60000);

	test('Goto definition in a package folder', async () => {
		console.log('=================== Load Lean File goto definition in a package folder ===================');

		// This test is run twice, once as an ad-hoc mode (no folder open)
		// and again using "open folder" mode.

		// Test we can load file in a project folder from a package folder and also
		// have goto definition work showing that the LeanClient is correctly
		// running in the package root.
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'simple');
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
		console.log(`>>> Found "${versionString}" in infoview`)

		const wordRange = findWord(editor, 'getLeanVersion');
		assert(wordRange, 'Missing getLeanVersion in Main.lean');

		// The -1 is to workaround a bug in goto definition.
		// The cursor must be placed before the end of the identifier.
		const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1);
		editor.selection = new vscode.Selection(wordRange.start, secondLastChar);

		await vscode.commands.executeCommand('editor.action.revealDefinition');

		// if goto definition worked, then we are in Version.lean and we should see the Lake version string.
		expectedVersion = 'Lake Version:';
		html = await waitForHtmlString(info, expectedVersion);

		const lakeVersionString = extractPhrase(html, 'Lake Version:', '<').trim();
		if (lakeVersionString) {
			console.log(`>>> Found "${lakeVersionString}" in infoview`)
		} else {
			assert(false, 'Lake Version: not found in infoview');
		}

		await sleep(1000);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000);

		// we should have no additional server because of this test, this files has been
		// opened in previous tests.
		await assertLeanServers(servers + 0, workers + 0);
	}).timeout(60000);


	test('Restart Server', async () => {

		console.log('=================== Test Restart Server ===================');

		// Test we can restart the lean server
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const [servers, workers] = await findLeanServers();

		// run this code twice to ensure that it still works after a Restart Server
		for (let i = 0; i < 2; i++) {

			const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'simple');
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

			await sleep(1000);

			// make sure test is always run in predictable state, which is no file or folder open
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');

			await sleep(1000);
		}

		await sleep(1000);

		// we should have no additional server because of this test.
		await assertLeanServers(servers + 0, workers + 0);

	}).timeout(60000);

}).timeout(60000);
