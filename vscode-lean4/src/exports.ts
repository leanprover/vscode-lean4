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

export interface Exports extends AlwaysEnabledFeatures {
    activatedLean4Features: Thenable<Lean4EnabledFeatures>
}
