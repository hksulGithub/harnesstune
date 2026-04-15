---
phase: 01-foundation-extension-scaffold-registry-sidebar
plan: 02
subsystem: registry-watchers-secrets
tags: [registry, file-watchers, secrets, vscode-fs, persistence, relative-pattern]
dependency_graph:
  requires: [01-PLAN.md]
  provides: [src/registry/WorkspaceRegistry.ts, src/watchers/FileWatcherManager.ts, src/secrets/SecretStore.ts]
  affects: [03-PLAN.md]
tech_stack:
  added: []
  patterns: [globalStorageUri JSON persistence, RelativePattern absolute-base file watchers, debounced event emission, context.secrets namespaced API keys]
key_files:
  created:
    - src/registry/WorkspaceRegistry.ts
    - src/registry/index.ts
    - src/watchers/FileWatcherManager.ts
    - src/watchers/index.ts
    - src/secrets/SecretStore.ts
    - src/secrets/index.ts
  modified:
    - src/extension.ts
decisions:
  - "load() made public (not private) so extension.ts can await initialization before commands are live"
  - "watchWorkspace is idempotent — guards against duplicate watchers if onDidChange fires for a workspace already being watched"
  - "removeWorkspace command explicitly calls unwatchWorkspace before registry.remove() to ensure watcher cleanup before registry event fires"
  - "secretStore exposed via void secretStore comment in extension.ts — will be passed to providers in Plan 03 rather than stored globally"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_created: 6
  files_modified: 1
---

# Phase 1 Plan 02: Workspace Registry, File Watchers, Secrets Summary

JSON-persisted workspace registry (CRUD at globalStorageUri), per-workspace file watchers using RelativePattern with absolute base, and context.secrets wrapper — all wired into extension activation with connect/remove commands.

## What Was Built

### Task 1: WorkspaceRegistry with JSON persistence (commit: d035bc0)

Created `src/registry/WorkspaceRegistry.ts` implementing `IWorkspaceRegistry`:

- **Constructor**: accepts `vscode.ExtensionContext`, computes registry path as `vscode.Uri.joinPath(context.globalStorageUri, 'workspaces.json')`
- **load()**: public async method — reads existing JSON via `vscode.workspace.fs.readFile`, validates `version: 1`, handles `FileNotFound` (ENOENT) by initializing empty state
- **getAll()**: returns shallow copy of internal array
- **getById()**: linear search by id
- **add()**: validates absolute rootPath (`/^\//.test()` or `/^[a-zA-Z]:\\/`), rejects duplicate rootPath, generates id via `crypto.randomUUID()`, initializes status as `'unknown'`, persists, fires `onDidChange`
- **remove()**: splices by index, persists, fires `onDidChange`; throws if id not found
- **update()**: merges changes + updates `lastUpdatedAt`, persists, fires `onDidChange`
- **persist()**: calls `vscode.workspace.fs.createDirectory(globalStorageUri)` first, then writes 2-space-indented JSON via `vscode.workspace.fs.writeFile`
- **onDidChange**: `vscode.EventEmitter<WorkspaceRecord[]>` exposed as `.event`

TypeScript verified: `npx tsc --project tsconfig.extension.json --noEmit` exits 0.

### Task 2: FileWatcherManager, SecretStore, extension.ts wiring (commit: 9189a1c)

**FileWatcherManager** (`src/watchers/FileWatcherManager.ts`):
- One `vscode.FileSystemWatcher` per workspace id stored in `Map<string, vscode.FileSystemWatcher>`
- Uses `new vscode.RelativePattern(vscode.Uri.file(workspace.rootPath), '**/*')` — absolute base Uri eliminates glob ambiguity
- All three events (`onDidChange`, `onDidCreate`, `onDidDelete`) route to a single debounced handler
- Debounce: 500ms per workspace using `Map<string, NodeJS.Timeout>`; each new event resets the timer
- `onDidWorkspaceChange` event fires workspace id after debounce settles
- `watchWorkspace` is idempotent (no-ops if already watching)
- `unwatchWorkspace` disposes watcher and clears pending timer
- Watchers pushed to `context.subscriptions` for automatic cleanup on deactivation

**SecretStore** (`src/secrets/SecretStore.ts`):
- Constructor takes `vscode.SecretStorage` directly (not the full context)
- Key prefix: `harnesstune.apiKey.` — namespaces all keys within the shared secrets store
- Three methods: `getApiKey`, `setApiKey`, `deleteApiKey` — thin wrappers over `secrets.get/store/delete`
- No reference to `globalState` anywhere

**extension.ts** updated:
- Imports `WorkspaceRegistry`, `FileWatcherManager`, `SecretStore`
- `activate()` made `async` to `await registry.load()`
- Initial watchers started for all persisted workspaces on startup
- `onDidChange` subscription syncs new watchers as workspaces are added
- `harnesstune.connectWorkspace`: `showOpenDialog(canSelectFolders: true)` → `showInputBox` for name → `registry.add()` → `watcherManager.watchWorkspace()`
- `harnesstune.removeWorkspace`: `showQuickPick` of current workspaces → `unwatchWorkspace` → `registry.remove()`
- Error handling on both commands via try/catch with `showErrorMessage`

Build verified: `node esbuild.mjs` exits 0, `dist/extension.js` contains WorkspaceRegistry, FileWatcherManager, SecretStore.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `load()` public, not `initialize()` | Extension.ts must `await registry.load()` before commands are live; public load() is clearer than a separate initialize method |
| `watchWorkspace` is idempotent | `onDidChange` fires the full updated list; any workspace already being watched must not get a duplicate watcher |
| `unwatchWorkspace` called before `registry.remove()` | Ensures watcher cleanup is deterministic — not dependent on the change event ordering |
| `SecretStore` takes `context.secrets`, not `context` | Minimal surface; SecretStore doesn't need the full context — only SecretStorage |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --project tsconfig.extension.json --noEmit` | Pass — 0 errors |
| `node esbuild.mjs` | Pass — Build complete |
| `test -f dist/extension.js` | Pass |
| `grep RelativePattern src/watchers/FileWatcherManager.ts` | Pass — `new vscode.RelativePattern(base, '**/*')` |
| `grep globalState src/secrets/SecretStore.ts` | Pass — no matches (uses context.secrets only) |
| `grep isAbsolute src/registry/WorkspaceRegistry.ts` | Pass — absolute path validation present |
| dist/extension.js contains WorkspaceRegistry, FileWatcherManager, SecretStore | Pass |

## Self-Check: PASSED

All 6 created files confirmed on disk. Both task commits (d035bc0, 9189a1c) confirmed in git log. dist/extension.js confirmed present and contains all three class names.
