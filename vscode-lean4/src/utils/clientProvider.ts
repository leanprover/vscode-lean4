import { LeanFileProgressProcessingInfo, ServerStoppedReason } from '@leanprover/infoview-api'
import { Disposable, EventEmitter, OutputChannel, commands } from 'vscode'
import { SetupDiagnostics, checkAll } from '../diagnostics/setupDiagnostics'
import { PreconditionCheckResult, SetupNotificationOptions } from '../diagnostics/setupNotifs'
import { LeanClient } from '../leanclient'
import { LeanPublishDiagnosticsParams } from './converters'
import { ExtUri, FileUri } from './exturi'
import { lean } from './leanEditorProvider'
import { LeanInstaller } from './leanInstaller'
import { logger } from './logger'
import { displayNotification } from './notifs'
import { findLeanProjectRootInfo, willUseLakeServer } from './projectInfo'

async function checkLean4ProjectPreconditions(
    channel: OutputChannel,
    context: string,
    existingFolderUris: ExtUri[],
    folderUri: ExtUri,
    fileUri: ExtUri,
    stopOtherServer: (folderUri: FileUri) => Promise<void>,
): Promise<PreconditionCheckResult> {
    const options: SetupNotificationOptions = {
        errorMode: { mode: 'NonModal' },
        warningMode: { modal: false, proceedByDefault: true },
    }
    const d = new SetupDiagnostics(options)
    return await checkAll(
        () => d.checkIsValidProjectFolder(channel, folderUri),
        () => d.checkIsLeanVersionUpToDate(channel, context, folderUri, { toolchainUpdateMode: 'PromptAboutUpdate' }),
        async () => {
            if (!(await willUseLakeServer(folderUri))) {
                return 'Fulfilled'
            }
            return await d.checkIsLakeInstalledCorrectly(channel, context, folderUri, {
                toolchainUpdateMode: 'PromptAboutUpdate',
            })
        },
        () => d.checkIsNestedProjectFolder(existingFolderUris, folderUri, fileUri, stopOtherServer),
    )
}

// This class ensures we have one LeanClient per folder.
export class LeanClientProvider implements Disposable {
    private subscriptions: Disposable[] = []
    private outputChannel: OutputChannel
    private installer: LeanInstaller
    private clients: Map<string, LeanClient> = new Map()
    private pending: Map<string, boolean> = new Map()
    private pendingInstallChanged: FileUri[] = []
    private processingInstallChanged: boolean = false
    private activeClient: LeanClient | undefined = undefined

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private diagnosticsChangedEmitter = new EventEmitter<LeanPublishDiagnosticsParams>()
    diagnosticsChanged = this.diagnosticsChangedEmitter.event

    private clientAddedEmitter = new EventEmitter<LeanClient>()
    clientAdded = this.clientAddedEmitter.event

    private clientRemovedEmitter = new EventEmitter<LeanClient>()
    clientRemoved = this.clientRemovedEmitter.event

    private clientStoppedEmitter = new EventEmitter<[LeanClient, boolean, ServerStoppedReason]>()
    clientStopped = this.clientStoppedEmitter.event

    constructor(installer: LeanInstaller, outputChannel: OutputChannel) {
        this.outputChannel = outputChannel
        this.installer = installer

        // we must setup the installChanged event handler first before any didOpenEditor calls.
        this.subscriptions.push(installer.installChanged(async (uri: FileUri) => await this.onInstallChanged(uri)))

        lean.visibleLeanEditors.forEach(e => this.ensureClient(e.documentExtUri))

        this.subscriptions.push(
            lean.onDidChangeActiveLeanEditor(async e => {
                if (e === undefined) {
                    return
                }
                await this.ensureClient(e.documentExtUri)
            }),
        )

        this.subscriptions.push(
            commands.registerCommand('lean4.restartFile', () => this.restartActiveFile()),
            commands.registerCommand('lean4.refreshFileDependencies', () => this.restartActiveFile()),
            commands.registerCommand('lean4.restartServer', () => this.restartActiveClient()),
            commands.registerCommand('lean4.stopServer', () => this.stopClient(undefined)),
        )

        this.subscriptions.push(lean.onDidOpenLeanDocument(document => this.ensureClient(document.extUri)))
    }

    getActiveClient(): LeanClient | undefined {
        // TODO: Most callers of this function probably don't need an active client, just the folder URI.
        return this.activeClient
    }

    private async onInstallChanged(uri: FileUri) {
        this.pendingInstallChanged.push(uri)
        if (this.processingInstallChanged) {
            // avoid re-entrancy.
            return
        }
        this.processingInstallChanged = true

        while (true) {
            const uri = this.pendingInstallChanged.pop()
            if (!uri) {
                break
            }
            try {
                const [cached, client] = await this.ensureClient(uri)
                if (cached && client) {
                    await client.restart()
                }
            } catch (e) {
                logger.log(`[ClientProvider] Exception checking lean version: ${e}`)
            }
        }
        this.processingInstallChanged = false
    }

    restartFile(uri: ExtUri) {
        const fileName = uri.scheme === 'file' ? uri.baseName() : 'untitled file'

        const client: LeanClient | undefined = this.findClient(uri)
        if (!client || !client.isRunning()) {
            displayNotification('Error', `No active client for '${fileName}'.`)
            return
        }

        const doc = lean.getLeanDocumentByUri(uri)
        if (doc === undefined) {
            displayNotification('Error', `'${fileName}' was closed in the meantime.`)
            return
        }

        void client.restartFile(doc)
    }

    restartActiveFile() {
        const doc = lean.lastActiveLeanDocument
        if (doc === undefined) {
            displayNotification(
                'Error',
                'No active Lean editor tab. Make sure to focus the Lean editor tab for which you want to issue a restart.',
            )
            return
        }
        this.restartFile(doc.extUri)
    }

    private async stopClient(folderUri: ExtUri | undefined) {
        let clientToStop: LeanClient
        if (folderUri === undefined) {
            if (this.activeClient === undefined) {
                displayNotification('Error', 'Cannot stop language server: No active client.')
                return
            }
            clientToStop = this.activeClient
        } else {
            const foundClient = this.getClientForFolder(folderUri)
            if (foundClient === undefined) {
                displayNotification(
                    'Error',
                    `Cannot stop language server: No client for project at '${folderUri.toString()}'.`,
                )
                return
            }
            clientToStop = foundClient
        }
        if (clientToStop.isStarted()) {
            await clientToStop.stop()
        }
        const key = clientToStop.folderUri.toString()
        this.clients.delete(key)
        this.pending.delete(key)
        if (clientToStop === this.activeClient) {
            this.activeClient = undefined
        }
    }

    private async restartActiveClient() {
        if (this.activeClient === undefined) {
            const activeUri = lean.lastActiveLeanDocument?.extUri
            if (activeUri === undefined) {
                displayNotification(
                    'Error',
                    'Cannot restart server: No focused Lean tab. Please focus the Lean tab for which you want to restart the server.',
                )
                return
            }

            const [cached, client] = await this.ensureClient(activeUri)
            if (cached) {
                await client?.restart()
            }
            return
        }

        await this.activeClient?.restart()
    }

    // Find the client for a given document.
    findClient(path: ExtUri) {
        const candidates = this.getClients().filter(client => client.isInFolderManagedByThisClient(path))
        // All candidate folders are a prefix of `path`, so they must necessarily be prefixes of one another
        // => the best candidate (the most top-level client folder) is just the one with the shortest path
        let bestCandidate: LeanClient | undefined
        for (const candidate of candidates) {
            if (!bestCandidate) {
                bestCandidate = candidate
                continue
            }
            const folder = candidate.getClientFolder()
            const bestFolder = bestCandidate.getClientFolder()
            if (
                folder.scheme === 'file' &&
                bestFolder.scheme === 'file' &&
                folder.fsPath.length < bestFolder.fsPath.length
            ) {
                bestCandidate = candidate
            }
        }
        return bestCandidate
    }

    getClients(): LeanClient[] {
        return Array.from(this.clients.values())
    }

    getClientForFolder(folder: ExtUri): LeanClient | undefined {
        return this.clients.get(folder.toString())
    }

    async ensureClient(uri: ExtUri): Promise<[boolean, LeanClient | undefined]> {
        const projectInfo = await findLeanProjectRootInfo(uri)
        if (projectInfo.kind === 'FileNotFound') {
            return [false, undefined]
        }
        if (projectInfo.kind === 'LakefileWithoutToolchain') {
            displayNotification(
                'Error',
                `Project at ${projectInfo.projectRootUri} has a Lakefile, but lacks a 'lean-toolchain' file. Please create one with the Lean version that you would like the project to use.`,
            )
            return [false, undefined]
        }
        const folderUri = projectInfo.projectRootUri
        let client = this.getClientForFolder(folderUri)
        if (client) {
            this.activeClient = client
            return [true, client]
        }

        const key = folderUri.toString()
        if (this.pending.has(key)) {
            return [false, undefined]
        }
        this.pending.set(key, true)

        const preconditionCheckResult = await checkLean4ProjectPreconditions(
            this.outputChannel,
            'Client Startup',
            this.getClients().map(client => client.folderUri),
            folderUri,
            uri,
            async (folderUriToStop: FileUri) => {
                await this.stopClient(folderUriToStop)
                await this.ensureClient(uri)
            },
        )
        if (preconditionCheckResult === 'Fatal') {
            this.pending.delete(key)
            this.activeClient = undefined
            return [false, undefined]
        }

        logger.log('[ClientProvider] Creating LeanClient for ' + folderUri.toString())
        client = new LeanClient(folderUri, this.outputChannel)
        this.subscriptions.push(client)
        this.clients.set(key, client)

        client.serverFailed(err => {
            if (this.activeClient === client) {
                this.activeClient = undefined
            }
            this.clients.delete(key)
            client.dispose()
            displayNotification('Error', err)
        })

        client.stopped(reason => {
            this.clientStoppedEmitter.fire([client, client === this.activeClient, reason])
        })

        // aggregate progress changed events.
        client.progressChanged(arg => {
            this.progressChangedEmitter.fire(arg)
        })

        client.diagnostics(p => {
            this.diagnosticsChangedEmitter.fire(p)
        })

        // Fired before starting the client because the InfoView uses this to register
        // events on `client` that fire during `start`.
        this.clientAddedEmitter.fire(client)

        await client.start()

        this.pending.delete(key)
        this.activeClient = client

        return [false, client]
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
