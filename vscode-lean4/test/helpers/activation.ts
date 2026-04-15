import * as assert from 'node:assert'
import { extensions } from 'vscode'
import { Exports } from '../../src/exports'
import { startOutputChannelCapture } from './outputChannels'

// Activates the lean4 extension and returns its exports. Fails loudly if the
// extension isn't present in the test host. Hooks `vscode.window.createOutputChannel`
// before activation so every write to a Lean output channel is captured in
// the state dump and mirrored to stdout — see `helpers/outputChannels.ts`.
export async function activateExtension(): Promise<Exports> {
    startOutputChannelCapture()
    const ext = extensions.getExtension('leanprover.lean4')
    assert.ok(ext, 'leanprover.lean4 extension must be installed in the test host')
    return (await ext.activate()) as Exports
}
