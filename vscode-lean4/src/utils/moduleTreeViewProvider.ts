import {
    commands,
    Disposable,
    Event,
    EventEmitter,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    Uri,
    window,
} from 'vscode'
import { LeanClientProvider } from './clientProvider'
import { LeanImport, LeanModule } from './converters'
import { parseExtUri } from './exturi'
import { lean } from './leanEditorProvider'
import { displayNotification } from './notifs'

export type TreeViewNode =
    | { kind: 'Root'; module: LeanModule }
    | { kind: 'Import'; import: LeanImport; parent: TreeViewNode }

function nodeModule(n: TreeViewNode): LeanModule {
    switch (n.kind) {
        case 'Root':
            return n.module
        case 'Import':
            return n.import.module
    }
}

export class ModuleTreeViewProvider implements Disposable, TreeDataProvider<TreeViewNode> {
    private subscriptions: Disposable[] = []
    private onDidChangeTreeDataEmitter: EventEmitter<TreeViewNode | undefined> = new EventEmitter<
        TreeViewNode | undefined
    >()
    readonly onDidChangeTreeData: Event<TreeViewNode | undefined> = this.onDidChangeTreeDataEmitter.event
    private view: TreeView<TreeViewNode>
    private mode: 'Imports' | 'ImportedBy'
    private currentRoot: TreeViewNode | undefined

    private constructor(private clientProvider: LeanClientProvider) {}

    static async init(clientProvider: LeanClientProvider): Promise<ModuleTreeViewProvider> {
        const p = new ModuleTreeViewProvider(clientProvider)
        await p.updateMode('Imports')
        p.subscriptions.push(window.registerTreeDataProvider('leanModuleHierarchy', p))
        p.subscriptions.push(
            commands.registerCommand('lean4.leanModuleHierarchy.showModuleHierarchy', () => p.showModuleHierarchy()),
            commands.registerCommand('lean4.leanModuleHierarchy.showInverseModuleHierarchy', () =>
                p.showInverseModuleHierarchy(),
            ),
            commands.registerCommand('lean4.leanModuleHierarchy.refresh', () => p.refresh()),
            commands.registerCommand('lean4.leanModuleHierarchy.showImports', () => p.showImports()),
            commands.registerCommand('lean4.leanModuleHierarchy.showImportedBy', () => p.showImportedBy()),
        )
        p.view = window.createTreeView('leanModuleHierarchy', {
            treeDataProvider: p,
            showCollapseAll: true,
        })
        p.updateDescription()
        p.subscriptions.push(p.view)
        return p
    }

    private async showModuleHierarchy() {
        await this.show('Imports')
        await this.refreshTree()
    }

    private async showInverseModuleHierarchy() {
        await this.show('ImportedBy')
        await this.refreshTree()
    }

    private async refresh() {
        await this.refreshRoot()
    }

    private async showImports() {
        await this.updateModeWithDescription('Imports')
        await this.refreshRoot()
    }

    private async showImportedBy() {
        await this.updateModeWithDescription('ImportedBy')
        await this.refreshRoot()
    }

    private async refreshRoot() {
        if (this.currentRoot) {
            this.onDidChangeTreeDataEmitter.fire(this.currentRoot)
            await this.view.reveal(this.currentRoot)
        } else {
            await this.refreshTree()
        }
    }

    private async refreshTree() {
        const root = await this.computeRoot()
        if (root === undefined) {
            return
        }
        // Necessary so that the `reveal` below selects the root when the view container of the `leanModuleHierarchy` is not visible.
        // Don't ask me why this makes it work. It's what VS Code's internal tree views do as well.
        await commands.executeCommand('leanModuleHierarchy.focus')
        this.onDidChangeTreeDataEmitter.fire(undefined)
        await this.view.reveal(root)
    }

    private async show(mode: 'Imports' | 'ImportedBy') {
        await this.updateModeWithDescription(mode)
        await commands.executeCommand('setContext', 'lean4.leanModuleHierarchy.visible', true)
    }

    private updateDescription() {
        switch (this.mode) {
            case 'Imports':
                this.view.description = 'Mode: Imports'
                return
            case 'ImportedBy':
                this.view.description = 'Mode: Imported By'
                return
        }
    }

    private async updateMode(mode: 'Imports' | 'ImportedBy') {
        this.mode = mode
        await commands.executeCommand('setContext', 'lean4.leanModuleHierarchy.mode', mode)
    }

    private async updateModeWithDescription(mode: 'Imports' | 'ImportedBy') {
        await this.updateMode(mode)
        this.updateDescription()
    }

    getDescription(n: TreeViewNode): string | undefined {
        switch (n.kind) {
            case 'Root':
                return undefined
            case 'Import':
                const k = n.import.kind
                const keywords = []
                if (k.isPrivate) {
                    keywords.push('private')
                }
                if (k.isAll) {
                    keywords.push('all')
                }
                if (k.metaKind === 'meta') {
                    keywords.push('meta')
                } else if (k.metaKind === 'full') {
                    keywords.push('meta + non-meta')
                }
                if (keywords.length === 0) {
                    return undefined
                }
                return `[${keywords.join(', ')}]`
        }
    }

    getTreeItem(n: TreeViewNode): TreeItem {
        const module = nodeModule(n)
        const uri = Uri.parse(module.uri)
        const collapsibleState =
            n.kind === 'Root' ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed
        return {
            label: module.name,
            description: this.getDescription(n),
            resourceUri: uri,
            iconPath: new ThemeIcon('file-code'),
            collapsibleState,
            command: {
                command: 'vscode.open',
                title: 'Open',
                arguments: [uri],
            },
        }
    }

    async getChildren(element?: TreeViewNode | undefined): Promise<TreeViewNode[] | undefined> {
        if (element === undefined) {
            const root = await this.computeRoot()
            if (root === undefined) {
                return undefined
            }
            return [root]
        }
        const elementUri = parseExtUri(nodeModule(element).uri)
        if (elementUri === undefined) {
            return undefined
        }
        const client = this.clientProvider.findClient(elementUri)
        if (client === undefined) {
            return undefined
        }
        switch (this.mode) {
            case 'Imports':
                const importsResult = await client.sendModuleHierarchyImports(nodeModule(element))
                if (importsResult.kind === 'StoppedClient') {
                    return undefined
                }
                if (importsResult.kind === 'Unsupported') {
                    this.displayUnsupportedModuleHierarchyError()
                    return
                }
                return importsResult.imports.map(i => ({ kind: 'Import', import: i, parent: element }))
            case 'ImportedBy':
                const importedByResult = await client.sendModuleHierarchyImportedBy(nodeModule(element))
                if (importedByResult.kind === 'StoppedClient') {
                    return undefined
                }
                if (importedByResult.kind === 'Unsupported') {
                    this.displayUnsupportedModuleHierarchyError()
                    return
                }
                return importedByResult.imports.map(i => ({ kind: 'Import', import: i, parent: element }))
        }
    }

    async computeRoot(): Promise<TreeViewNode | undefined> {
        const lastActiveUri = lean.lastActiveLeanDocument?.extUri
        if (lastActiveUri === undefined) {
            return undefined
        }
        const client = this.clientProvider.findClient(lastActiveUri)
        if (client === undefined) {
            return undefined
        }
        const r = await client.sendPrepareModuleHierarchy(lastActiveUri)
        if (r.kind === 'StoppedClient') {
            return undefined
        }
        if (r.kind === 'Unsupported') {
            this.displayUnsupportedModuleHierarchyError()
            return
        }
        if (r.module === undefined) {
            return undefined
        }
        const root: TreeViewNode = { kind: 'Root', module: r.module }
        this.currentRoot = root
        return root
    }

    displayUnsupportedModuleHierarchyError() {
        displayNotification('Error', 'This command is only supported in Lean versions >= v4.22.0.')
    }

    async getParent?(element: TreeViewNode): Promise<TreeViewNode | undefined> {
        switch (element.kind) {
            case 'Root':
                return undefined
            case 'Import':
                return element.parent
        }
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
