import assert from 'assert'
import { suite } from 'mocha'
import { batchExecute, ExecutionExitCode } from '../../../src/utils/batch'
import { elanInstallationMethod } from '../../../src/utils/leanInstaller'
import { logger } from '../../../src/utils/logger'
import { displayNotification } from '../../../src/utils/notifs'
import { cleanTempFolder, closeAllEditors, getAltBuildVersion, getTestLeanVersion } from '../utils/helpers'

suite('Lean4 Bootstrap Test Suite', () => {
    test('Install Elan', async () => {
        logger.log('=================== Install elan on demand ===================')
        displayNotification('Information', 'Running tests: ' + __dirname)

        cleanTempFolder('elan')

        const method = elanInstallationMethod()
        const result = await batchExecute(method.script, [], undefined, undefined, undefined, method.shell)
        assert(result.exitCode === ExecutionExitCode.Success)
        const result2 = await batchExecute('elan', ['toolchain', 'install', 'leanprover/lean4:' + getTestLeanVersion()])
        assert(result2.exitCode === ExecutionExitCode.Success)
        const result3 = await batchExecute('elan', ['default', 'leanprover/lean4:' + getTestLeanVersion()])
        assert(result3.exitCode === ExecutionExitCode.Success)
        const result4 = await batchExecute('elan', ['toolchain', 'install', 'leanprover/lean4:' + getAltBuildVersion()])
        assert(result4.exitCode === ExecutionExitCode.Success)

        logger.log('Lean installation is complete.')

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(600000) // give it 5 minutes to install lean in case test machine is really slow.
}).timeout(60000)
