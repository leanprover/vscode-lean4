import { OutputChannel } from 'vscode'
import { DocViewProvider } from './docview'
import { InfoProvider } from './infoview'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanInstaller } from './utils/leanInstaller'

export interface AlwaysEnabledFeatures {
    docView: DocViewProvider
    projectInitializationProvider: ProjectInitializationProvider
    outputChannel: OutputChannel
    installer: LeanInstaller
}

export interface Lean4EnabledFeatures {
    clientProvider: LeanClientProvider
    infoProvider: InfoProvider
    projectOperationProvider: ProjectOperationProvider
}

export interface EnabledFeatures extends AlwaysEnabledFeatures, Lean4EnabledFeatures {}

export class Exports {
    alwaysEnabledFeatures: AlwaysEnabledFeatures
    lean4EnabledFeatures: Promise<Lean4EnabledFeatures>

    constructor(alwaysEnabledFeatures: AlwaysEnabledFeatures, lean4EnabledFeatures: Promise<Lean4EnabledFeatures>) {
        this.alwaysEnabledFeatures = alwaysEnabledFeatures
        this.lean4EnabledFeatures = lean4EnabledFeatures
    }

    async allFeatures(): Promise<EnabledFeatures> {
        const lean4EnabledFeatures = await this.lean4EnabledFeatures
        return { ...this.alwaysEnabledFeatures, ...lean4EnabledFeatures }
    }
}
