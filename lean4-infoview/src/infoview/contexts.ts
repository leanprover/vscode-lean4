import React from "react";
import { DocumentUri, Diagnostic } from "vscode-languageserver-protocol";

import { LeanFileProgressProcessingInfo } from "../lspTypes";
import { EditorConnection } from "./editorConnection";
import { InfoviewConfig, defaultInfoviewConfig } from "../infoviewApi";
import { RpcSessions } from "./rpcSessions";
import { ServerVersion } from "./serverVersion";

// Type-unsafe initializers for contexts which we immediately set up at the top-level.
export const EditorContext = React.createContext<EditorConnection>(null as any);
export const RpcContext = React.createContext<RpcSessions>(null as any);
export const VersionContext = React.createContext<ServerVersion | undefined>(undefined);

export const ConfigContext = React.createContext<InfoviewConfig>(defaultInfoviewConfig);
export const LspDiagnosticsContext = React.createContext<Map<DocumentUri, Diagnostic[]>>(new Map());
export const ProgressContext = React.createContext<Map<DocumentUri, LeanFileProgressProcessingInfo[]>>(new Map());
