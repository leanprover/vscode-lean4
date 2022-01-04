import React from 'react';
import { DocumentUri, Diagnostic } from 'vscode-languageserver-protocol';

import { LeanFileProgressProcessingInfo, InfoviewConfig, defaultInfoviewConfig } from '@lean4/infoview-api';

import { EditorConnection } from './editorConnection';
import { RpcSessions } from './rpcSessions';
import { ServerVersion } from './serverVersion';

// Type-unsafe initializers for contexts which we immediately set up at the top-level.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
export const EditorContext = React.createContext<EditorConnection>(null as any);
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
export const RpcContext = React.createContext<RpcSessions>(null as any);
export const VersionContext = React.createContext<ServerVersion | undefined>(undefined);

export const ConfigContext = React.createContext<InfoviewConfig>(defaultInfoviewConfig);
export const LspDiagnosticsContext = React.createContext<Map<DocumentUri, Diagnostic[]>>(new Map());
export const ProgressContext = React.createContext<Map<DocumentUri, LeanFileProgressProcessingInfo[]>>(new Map());

export const TipContext = React.createContext<TipChainState>(new TipChainState());
