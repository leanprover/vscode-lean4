import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanInstaller } from './utils/leanInstaller'
import { LeanClientProvider } from './utils/clientProvider';
import { ProjectInitializationProvider } from './projectinit';
import { ProjectOperationProvider } from './projectoperations';

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
