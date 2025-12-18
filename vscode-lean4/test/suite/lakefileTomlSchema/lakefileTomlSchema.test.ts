import assert from 'assert'
import * as fs from 'fs'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import { sleep } from '../utils/helpers'

suite('Tests', () => {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..', '..')
    const testCaseLocation = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'lakefileTomlSchemaTestCases')
    const validLakefilesDirectory = path.join(testCaseLocation, 'valid')
    const invalidLakefilesDirectory = path.join(testCaseLocation, 'invalid')

    for (const testFileName of fs.readdirSync(invalidLakefilesDirectory)) {
        const testFileLocation = path.join(invalidLakefilesDirectory, testFileName)
        test(testFileName, async () => {
            logger.log('=================== Ensure ${testFileName} is rejected ===================')
            assert(vscode.workspace.workspaceFolders !== undefined, 'No workspace folder is opened')
            assert(vscode.workspace.workspaceFolders.length === 1, 'Exactly one workspace folder should be opened ')
            const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.path
            const lakefilePath = path.join(workspaceFolder, 'lakefile.toml')

            assert(fs.existsSync(testFileLocation), `Test case location does not exist: ${testFileLocation}`)

            fs.copyFileSync(testFileLocation, lakefilePath)

            const document = await vscode.workspace.openTextDocument(lakefilePath)
            await vscode.window.showTextDocument(document)

            await sleep(10 * 1000)
        })
    }

    for (const testFileName of fs.readdirSync(validLakefilesDirectory)) {
        const testFileLocation = path.join(validLakefilesDirectory, testFileName)
        test(testFileName, async () => {
            logger.log(`=================== Ensure ${testFileName} is accepted ===================`)
            assert(vscode.workspace.workspaceFolders !== undefined, 'No workspace folder is opened')
            assert(vscode.workspace.workspaceFolders.length === 1, 'Exactly one workspace folder should be opened ')
            const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.path
            const lakefilePath = path.join(workspaceFolder, 'lakefile.toml')

            assert(fs.existsSync(testFileLocation), `Test case location does not exist: ${testFileLocation}`)

            fs.copyFileSync(testFileLocation, lakefilePath)

            const document = await vscode.workspace.openTextDocument(lakefilePath)
            await vscode.window.showTextDocument(document)

            await sleep(10 * 1000)
        })
    }
})
