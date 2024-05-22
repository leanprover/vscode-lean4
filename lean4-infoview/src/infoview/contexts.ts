import * as React from 'react'
import type { Diagnostic, DocumentUri } from 'vscode-languageserver-protocol'

import { defaultInfoviewConfig, InfoviewConfig, LeanFileProgressProcessingInfo } from '@leanprover/infoview-api'

import { EditorConnection } from './editorConnection'
import { ServerVersion } from './serverVersion'
import { DocumentPosition } from './util'

// Type-unsafe initializers for contexts which we immediately set up at the top-level.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
export const EditorContext = React.createContext<EditorConnection>(null as any)
export const VersionContext = React.createContext<ServerVersion | undefined>(undefined)

export const ConfigContext = React.createContext<InfoviewConfig>(defaultInfoviewConfig)
export const LspDiagnosticsContext = React.createContext<Map<DocumentUri, Diagnostic[]>>(new Map())
export const ProgressContext = React.createContext<Map<DocumentUri, LeanFileProgressProcessingInfo[]>>(new Map())

/**
 * Many infoview components display information
 * that is _about_ a position in a Lean source file:
 * - a `<PanelWidgetDisplay>` displays a panel widget
 *   saved at a syntactic span that contains a specific position
 *   (the editor cursor position or a pinned position).
 * - similarly, an `<InteractiveMessage>` can come from a diagnostic
 *   emitted for a syntactic span (its `fullRange`).
 *
 * Within such components, this context keeps track of the relevant position:
 * - in a `<PanelWidgetDisplay>`,
 *   it is the position at which the widget is being displayed
 *   (when shown in the at-cursor `<InfoDisplay>`,
 *   this will lag behind the editor cursor position
 *   when the `<InfoDisplay>` is in the process of updating).
 * - in an `<InteractiveMessage>` that comes from a diagnostic
 *   associated with a syntactic range,
 *   it is the start of the range.
 *
 * Note that, in general, there will be other positions around.
 * For example, the editor cursor position is in general independent of the {@link PosContext}.
 */
export const PosContext = React.createContext<DocumentPosition | undefined>(undefined)
