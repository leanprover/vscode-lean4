import {DocumentLinkProvider, TextDocument, DocumentLink, ProviderResult, Range, workspace, window} from 'vscode';

const seeNoteRegex = /note \[([^\]]+)\]/gi;
const libraryNoteRegex = /library_note "(.*)"/g;

export class LibraryNoteLinkProvider implements DocumentLinkProvider {
    provideDocumentLinks(document: TextDocument): ProviderResult<DocumentLink[]> {
        const links: DocumentLink[] = [];
        for (const m of document.getText().matchAll(seeNoteRegex)) {
            const link = new DocumentLink(new Range(
                document.positionAt(m.index), document.positionAt(m.index + m[0].length)));
            link.tooltip = m[1];
            links.push(link);
        }
        return links;
    }

    async resolveDocumentLink(link: DocumentLink): Promise<DocumentLink> {
        const noteName = link.tooltip;
        for (const leanFile of await workspace.findFiles('**/*.lean')) {
            const content = (await workspace.fs.readFile(leanFile)).toString();
            for (const m of content.matchAll(libraryNoteRegex)) {
                console.log(m[1]);
                if (m[1] === noteName) {
                    const lineNo = content.substr(0, m.index).split(/\r\n|\r|\n/).length;
                    link.target = leanFile.with({ fragment: `L${lineNo}` });
                    return link;
                }
            }
        }
        await window.showErrorMessage(`Library note "${noteName}" not found.`);
    }
}
