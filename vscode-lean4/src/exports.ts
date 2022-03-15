import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanInstaller } from './utils/leanInstaller'
import { LeanClientProvider } from './utils/clientProvider';

export interface Exports {
    isLean4Project: boolean;
    version: string;
    infoProvider: InfoProvider | undefined;
    clientProvider: LeanClientProvider | undefined;
    installer : LeanInstaller | undefined;
    docView : DocViewProvider | undefined;
}
