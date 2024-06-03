import { globSync } from 'glob'
import Mocha from 'mocha'
import * as path from 'path'
import { getTestFolder } from '../../../src/config'
import { logger } from '../../../src/utils/logger'

export function run(testsRoot: string, cb: (error: any, failures?: number) => void): void {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
    })

    if (process.platform === 'win32') {
        // workaround for https://github.com/microsoft/vscode-test/issues/134
        testsRoot = testsRoot.toLowerCase()
    }
    const folder = getTestFolder()
    if (folder) {
        testsRoot = path.resolve(testsRoot, '..', folder)
    }

    logger.log('>>>>>>>>> testsRoot=' + testsRoot)

    try {
        const files = globSync('**/**.test.js', { cwd: testsRoot })

        // Add files to the test suite
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)))

        // Run the mocha test
        mocha.timeout(60000) // 60 seconds to run
        mocha.run(failures => {
            cb(null, failures)
        })
    } catch (err) {
        console.error(err)
        cb(err)
    }
}
