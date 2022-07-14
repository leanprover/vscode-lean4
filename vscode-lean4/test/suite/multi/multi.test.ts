import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { initLean4, assertStringInInfoview, closeAllEditors, getAltBuildVersion } from '../utils/helpers';
import { logger } from '../../../src/utils/logger'

suite('Multi-Folder Test Suite', () => {

    test('Load a multi-project workspace', async () => {

        logger.log('=================== Load Lean Files in a multi-project workspace ===================');
        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const multiRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'multi');
        const lean = await initLean4(path.join(multiRoot, 'test', 'Main.lean'));

        // verify we have a nightly build running in this folder.
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');
        await assertStringInInfoview(info, '4.0.0-nightly-');

        // Now open a file from the other project
        const doc2 = await vscode.workspace.openTextDocument(path.join(multiRoot, 'foo', 'Foo.lean'));
        const version = getAltBuildVersion();
        const options : vscode.TextDocumentShowOptions = { preview: false };
        await vscode.window.showTextDocument(doc2, options);

        logger.log(`wait for version ${version} to load...`);
        await assertStringInInfoview(info, version);

        // Now verify we have 2 LeanClients running.
        const clients = lean.exports.clientProvider;
        assert(clients, 'No LeanClientProvider export');
        const actual = clients.getClients().length
        assert(actual === 2, 'Expected 2 LeanClients to be running, but found ' + actual);

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();
    }).timeout(60000);

}).timeout(60000);
