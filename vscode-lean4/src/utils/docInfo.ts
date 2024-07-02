import { TabInputText, TextDocument, window, workspace } from 'vscode'
import { ExtUri, extUriEquals, toExtUri } from './exturi'

export function collectAllOpenLeanDocuments(): TextDocument[] {
    const documentsByUri: Map<string, TextDocument> = new Map<string, TextDocument>()
    for (const doc of workspace.textDocuments) {
        documentsByUri.set(doc.uri.toString(), doc)
    }

    const visibleDocs: TextDocument[] = []
    for (const tab of window.tabGroups.all.flatMap(group => group.tabs)) {
        if (!(tab.input instanceof TabInputText)) {
            continue
        }
        const uri = toExtUri(tab.input.uri)
        if (uri === undefined) {
            continue
        }

        const doc = documentsByUri.get(uri.toString())
        if (doc === undefined || doc.languageId !== 'lean4') {
            continue
        }

        visibleDocs.push(doc)
    }

    return visibleDocs
}

export function collectAllOpenLeanDocumentUris(): ExtUri[] {
    return collectAllOpenLeanDocuments().map(doc => {
        const uri = toExtUri(doc.uri)
        if (uri === undefined) {
            throw new Error()
        }
        return uri
    })
}

export function isOpenLeanDocument(docUri : ExtUri): boolean {
    const openDocUris: ExtUri[] = collectAllOpenLeanDocumentUris()
    return openDocUris.some(openDocUri => extUriEquals(openDocUri, docUri))
}