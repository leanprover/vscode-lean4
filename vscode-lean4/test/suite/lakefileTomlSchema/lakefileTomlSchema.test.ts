import assert from 'assert'
import * as fs from 'fs'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import { closeAllEditors, sleep, waitForActiveExtension } from '../utils/helpers'

const tombiExtensionId = 'tombi-toml.tombi'
const diagnosticsTimeoutMs = 45 * 1000

function tombiDiagnostics(uri: vscode.Uri, severity: vscode.DiagnosticSeverity): vscode.Diagnostic[] {
    return vscode.languages
        .getDiagnostics(uri)
        .filter(diagnostic => diagnostic.source === 'Tombi' && diagnostic.severity === severity)
}

function formatDiagnostics(diagnostics: vscode.Diagnostic[]): string {
    return diagnostics.map(d => `${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`).join('\n')
}

async function waitForTombiDiagnostics(
    uri: vscode.Uri,
    severity: vscode.DiagnosticSeverity,
): Promise<vscode.Diagnostic[]> {
    const start = Date.now()
    while (Date.now() - start < diagnosticsTimeoutMs) {
        const diagnostics = tombiDiagnostics(uri, severity)
        if (diagnostics.length > 0) {
            return diagnostics
        }
        await sleep(500)
    }
    return []
}

// A valid `lakefile.toml` has no diagnostics, so the absence of diagnostics alone does not prove that
// Tombi validated the file against the Lake schema. Tombi shows the location of the schema in its hover,
// so we wait until the hover of the `name` key refers to the Lake schema.
async function waitForLakefileSchema(document: vscode.TextDocument): Promise<boolean> {
    const nameKey = /^name\s*=/m.exec(document.getText())
    assert(nameKey !== null, 'Expected a `name` key in the valid lakefile.toml')
    const position = document.positionAt(nameKey.index)
    const start = Date.now()
    while (Date.now() - start < diagnosticsTimeoutMs) {
        const hovers =
            (await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                document.uri,
                position,
            )) ?? []
        const hoverText = hovers
            .flatMap(hover => hover.contents)
            .map(content => (typeof content === 'string' ? content : content.value))
            .join('\n')
        if (hoverText.includes('lakefile-toml-schema')) {
            return true
        }
        await sleep(500)
    }
    return false
}

suite('Tests', () => {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..', '..')
    const testCaseLocation = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'lakefileTomlSchemaTestCases')

    async function openLakefile(kind: string, testFileName: string): Promise<vscode.TextDocument> {
        assert(vscode.workspace.workspaceFolders !== undefined, 'No workspace folder is opened')
        assert(vscode.workspace.workspaceFolders.length === 1, 'Exactly one workspace folder should be opened ')
        const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath
        logger.log(`Found workspace folder at ${workspaceFolder}`)

        const testFileLocation = path.join(testCaseLocation, kind, testFileName)
        assert(fs.existsSync(testFileLocation), `Test case location does not exist: ${testFileLocation}`)

        // Every test case gets its own `lakefile.toml` so that the document or the diagnostics
        // of an earlier test case cannot affect a later test case.
        const lakefileDirectory = path.join(
            workspaceFolder,
            'lakefileTomlSchemaTestCases',
            kind,
            path.parse(testFileName).name,
        )
        fs.mkdirSync(lakefileDirectory, { recursive: true })
        const lakefilePath = path.join(lakefileDirectory, 'lakefile.toml')
        fs.copyFileSync(testFileLocation, lakefilePath)

        await closeAllEditors()
        const document = await vscode.workspace.openTextDocument(lakefilePath)
        await vscode.window.showTextDocument(document)

        const tombi = await waitForActiveExtension(tombiExtensionId)
        assert(tombi !== null, `Extension ${tombiExtensionId} is not installed`)
        logger.log(`Found ${tombiExtensionId} version ${tombi.packageJSON.version}`)

        return document
    }

    function testCases(kind: string): string[] {
        return fs.readdirSync(path.join(testCaseLocation, kind)).filter(fileName => fileName.endsWith('.toml'))
    }

    for (const testFileName of testCases('invalid')) {
        test(`invalid/${testFileName}`, async () => {
            logger.log(`=================== Ensure ${testFileName} is rejected ===================`)
            const document = await openLakefile('invalid', testFileName)

            const errors = await waitForTombiDiagnostics(document.uri, vscode.DiagnosticSeverity.Error)
            assert(errors.length > 0, 'Expected at least one error diagnostic for invalid lakefile.toml')
            logger.log(`Errors:\n${formatDiagnostics(errors)}`)

            // In strict mode, Tombi reports valid keys as unknown when a document has an error
            // and the schema does not explicitly allow additional properties.
            const warnings = tombiDiagnostics(document.uri, vscode.DiagnosticSeverity.Warning)
            assert(
                warnings.length === 0,
                `Expected no warning diagnostics for invalid lakefile.toml, but got:\n${formatDiagnostics(warnings)}`,
            )
        })
    }

    for (const testFileName of testCases('valid')) {
        test(`valid/${testFileName}`, async () => {
            logger.log(`=================== Ensure ${testFileName} is accepted ===================`)
            const document = await openLakefile('valid', testFileName)

            assert(await waitForLakefileSchema(document), 'Tombi did not load the lakefile.toml schema')
            // Give Tombi time to publish the diagnostics of the document.
            await sleep(3 * 1000)

            const problems = [
                ...tombiDiagnostics(document.uri, vscode.DiagnosticSeverity.Error),
                ...tombiDiagnostics(document.uri, vscode.DiagnosticSeverity.Warning),
            ]
            assert(
                problems.length === 0,
                `Expected no error or warning diagnostics for valid lakefile.toml, but got:\n${formatDiagnostics(problems)}`,
            )
        })
    }
})
