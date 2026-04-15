import * as assert from 'node:assert'
import { extensions } from 'vscode'
import { activateExtension } from '../helpers/activation'

describe('extension activation', () => {
    it('activates the lean4 extension', async () => {
        await activateExtension()
        const ext = extensions.getExtension('leanprover.lean4')
        assert.ok(ext?.isActive, 'extension should be active after activate()')
    })
})
