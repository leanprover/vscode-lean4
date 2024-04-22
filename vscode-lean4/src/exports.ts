import { DocViewProvider } from './docview'
import { InfoProvider } from './infoview'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanInstaller } from './utils/leanInstaller'

export interface Exports {
    isLean4Project: boolean
    version: string | undefined
    infoProvider: InfoProvider | undefined
    clientProvider: LeanClientProvider | undefined
    projectOperationProvider: ProjectOperationProvider | undefined
    installer: LeanInstaller | undefined
    docView: DocViewProvider | undefined
    projectInitializationProver: ProjectInitializationProvider | undefined
}
