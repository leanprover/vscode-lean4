import React from "react";
import { DocumentUri } from "vscode-languageserver-protocol";

import { LeanDiagnostic, LeanFileProgressProcessingInfo } from "../lspTypes";
import { EditorConnection } from "./editorConnection";
import { InfoviewConfig, defaultInfoviewConfig } from "../infoviewApi";

// Type-unsafe initializer but we never render any components without a proper EditorContext.
export const EditorContext = React.createContext<EditorConnection>(null as any);
export const ConfigContext = React.createContext<InfoviewConfig>(defaultInfoviewConfig);
export const DiagnosticsContext = React.createContext<Map<DocumentUri, LeanDiagnostic[]>>(new Map());
export const ProgressContext = React.createContext<Map<DocumentUri, LeanFileProgressProcessingInfo[]>>(new Map());