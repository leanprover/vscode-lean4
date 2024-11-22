import { OutputChannel } from 'vscode'
import { FullDiagnosticsProvider } from './diagnostics/fullDiagnostics'
import { InfoProvider } from './infoview'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanClientProvider } from './utils/clientProvider'
import { ElanCommandProvider } from './utils/elanCommands'
import { LeanInstaller } from './utils/leanInstaller'

export interface AlwaysEnabledFeatures {
    projectInitializationProvider: ProjectInitializationProvider
    outputChannel: OutputChannel
    installer: LeanInstaller
    fullDiagnosticsProvider: FullDiagnosticsProvider
    elanCommandProvider: ElanCommandProvider
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
