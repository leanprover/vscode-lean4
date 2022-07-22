import * as React from 'react';
import type { DocumentUri, Diagnostic } from 'vscode-languageserver-protocol';

import { LeanFileProgressProcessingInfo, InfoviewConfig, defaultInfoviewConfig } from '@lean4/infoview-api';

import { EditorConnection } from './editorConnection';
import { ServerVersion } from './serverVersion';

// Type-unsafe initializers for contexts which we immediately set up at the top-level.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
export const EditorContext = React.createContext<EditorConnection>(null as any);
export const VersionContext = React.createContext<ServerVersion | undefined>(undefined);

export const ConfigContext = React.createContext<InfoviewConfig>(defaultInfoviewConfig);
export const LspDiagnosticsContext = React.createContext<Map<DocumentUri, Diagnostic[]>>(new Map());
export const ProgressContext = React.createContext<Map<DocumentUri, LeanFileProgressProcessingInfo[]>>(new Map());
