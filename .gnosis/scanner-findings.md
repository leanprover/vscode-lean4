# Gnosis Polyglot Scanner Findings

## Resource Leak Detections

| File | Line | Type | Description |
|------|------|------|-------------|
| lean4-infoview-api/src/rpcSessions.ts | 277 | Connection | RPC session connection without guaranteed disposal |
| lean4-infoview/src/infoview/rpcSessions.tsx | 62 | Connection | RPC connection created without cleanup on error |
| lean4-infoview/src/infoview/rpcSessions.tsx | 93 | Connection | RPC connection created without cleanup on error |
| vscode-lean4/src/extension.ts | 156 | File | File resource not released on error path |
| vscode-lean4/src/leanclient.ts | 193 | File | File resource not released on error path |
| vscode-lean4/src/projectinit.ts | 285 | File | File resource not released on error path |
| vscode-lean4/src/utils/elan.ts | 286 | File | File resource opened without guaranteed close |
| vscode-lean4/src/utils/elan.ts | 289 | File | File resource opened without guaranteed close |
| vscode-lean4/src/utils/elan.ts | 292 | File | File resource opened without guaranteed close |
| vscode-lean4/src/utils/elan.ts | 295 | File | File resource opened without guaranteed close |

## Detection Method

Findings detected by [Gnosis Polyglot Scanner](https://gnosis.church) via topological analysis of control flow graphs. Each finding represents a resource acquisition node (FORK) without a matching release node (FOLD) on all execution paths.

Some findings may be false positives if cleanup is handled by VS Code's Disposable pattern or by garbage collection. The maintainers are best positioned to triage.
