---
phase: 01-foundation-extension-scaffold-registry-sidebar
plan: 02
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/registry/WorkspaceRegistry.ts
  - src/registry/index.ts
  - src/watchers/FileWatcherManager.ts
  - src/watchers/index.ts
  - src/secrets/SecretStore.ts
  - src/secrets/index.ts
  - src/extension.ts
autonomous: true
requirements: [FOUN-03, FOUN-04, WKSP-01, WKSP-03, WKSP-04, WKSP-05]

must_haves:
  truths:
    - "User can connect an existing agent directory as a workspace and it persists after VSCode restart"
    - "User can remove a workspace and it disappears from the registry"
    - "File watchers monitor workspace directories using RelativePattern with absolute base paths"
    - "API keys are stored via context.secrets, never globalState"
  artifacts:
    - path: "src/registry/WorkspaceRegistry.ts"
      provides: "CRUD operations for workspace records persisted as JSON at globalStorageUri"
      exports: ["WorkspaceRegistry"]
    - path: "src/watchers/FileWatcherManager.ts"
      provides: "File watcher lifecycle management using RelativePattern with absolute base"
      exports: ["FileWatcherManager"]
    - path: "src/secrets/SecretStore.ts"
      provides: "Wrapper around context.secrets for API key storage"
      exports: ["SecretStore"]
  key_links:
    - from: "src/registry/WorkspaceRegistry.ts"
      to: "globalStorageUri/workspaces.json"
      via: "fs.readFile/writeFile on URI path"
      pattern: "globalStorageUri"
    - from: "src/watchers/FileWatcherManager.ts"
      to: "vscode.RelativePattern"
      via: "RelativePattern constructor with absolute base path"
      pattern: "new vscode.RelativePattern"
    - from: "src/extension.ts"
      to: "src/registry/WorkspaceRegistry.ts"
      via: "instantiation in activate()"
      pattern: "new WorkspaceRegistry"
---

<objective>
Implement the workspace registry (JSON-based CRUD at globalStorageUri), file watcher pipeline (RelativePattern with absolute base paths, debounce), and secrets storage (context.secrets wrapper). Wire all three into the extension activation lifecycle.

Purpose: The registry is the data backbone for everything — sidebar, dashboard, and adapters all read from it. File watchers enable live status updates. Secrets store ensures API keys never leak into globalState.
Output: Working registry with add/remove/update, file watchers per workspace, secrets API, all registered in extension.ts.
</objective>

<execution_context>
@/Users/hksul/.claude/get-shit-done/workflows/execute-plan.md
@/Users/hksul/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/research/SUMMARY.md

<interfaces>
<!-- Types defined in Plan 01 that this plan implements against -->

From src/types/workspace.ts:
```typescript
export type WorkspaceStatus = 'running' | 'idle' | 'warning' | 'error' | 'unknown';

export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  status: WorkspaceStatus;
  addedAt: string;
  lastUpdatedAt: string;
  runningAgentCount: number;
  errorCount: number;
}

export interface WorkspaceRegistryData {
  version: 1;
  workspaces: WorkspaceRecord[];
}

export interface IWorkspaceRegistry {
  getAll(): WorkspaceRecord[];
  getById(id: string): WorkspaceRecord | undefined;
  add(name: string, rootPath: string): Promise<WorkspaceRecord>;
  remove(id: string): Promise<void>;
  update(id: string, changes: Partial<Pick<WorkspaceRecord, 'status' | 'runningAgentCount' | 'errorCount'>>): Promise<void>;
  onDidChange: import('vscode').Event<WorkspaceRecord[]>;
}
```

From src/types/messages.ts:
```typescript
export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord };
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement WorkspaceRegistry with JSON persistence at globalStorageUri</name>
  <files>src/registry/WorkspaceRegistry.ts, src/registry/index.ts</files>
  <read_first>
    - src/types/workspace.ts (WorkspaceRecord, WorkspaceRegistryData, IWorkspaceRegistry interfaces — the contracts to implement)
    - src/extension.ts (current state — will be modified in Task 2)
    - .planning/research/SUMMARY.md (globalStorageUri persistence approach)
  </read_first>
  <action>
Implement the `WorkspaceRegistry` class that satisfies `IWorkspaceRegistry`:

**src/registry/WorkspaceRegistry.ts:**

Constructor takes `vscode.ExtensionContext`. On construction:
- Compute registry file path: `vscode.Uri.joinPath(context.globalStorageUri, 'workspaces.json')`
- Load existing data from file if it exists, otherwise initialize with `{ version: 1, workspaces: [] }`
- Use `vscode.workspace.fs.readFile` and `vscode.workspace.fs.writeFile` (not Node fs) for VSCode-compatible file access

Methods:
- `getAll(): WorkspaceRecord[]` — return shallow copy of workspaces array
- `getById(id: string): WorkspaceRecord | undefined` — find by id
- `add(name: string, rootPath: string): Promise<WorkspaceRecord>` — validate rootPath is absolute (starts with `/` on macOS/Linux or drive letter on Windows), check for duplicates by rootPath, generate UUID v4 using `crypto.randomUUID()`, create record with status `'unknown'`, runningAgentCount 0, errorCount 0, addedAt/lastUpdatedAt as `new Date().toISOString()`, persist to file, fire change event, return the new record
- `remove(id: string): Promise<void>` — remove from array, persist, fire change event. Throw if id not found.
- `update(id: string, changes): Promise<void>` — merge changes into existing record, set lastUpdatedAt to current ISO timestamp, persist, fire change event
- `onDidChange` — use `vscode.EventEmitter<WorkspaceRecord[]>`, expose `.event` property

Private method `persist(): Promise<void>` — serialize `WorkspaceRegistryData` to JSON with 2-space indent, write via `vscode.workspace.fs.writeFile`. Ensure globalStorageUri directory exists first via `vscode.workspace.fs.createDirectory`.

Private method `load(): Promise<void>` — read file, parse JSON, validate version field equals 1, populate internal array. If file missing, initialize empty.

Export the class and a barrel `src/registry/index.ts` re-exporting it.
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npx tsc --project tsconfig.extension.json --noEmit && echo "REGISTRY OK"</automated>
  </verify>
  <acceptance_criteria>
    - src/registry/WorkspaceRegistry.ts contains `class WorkspaceRegistry` that implements `IWorkspaceRegistry`
    - WorkspaceRegistry constructor accepts `vscode.ExtensionContext`
    - `add()` method calls `crypto.randomUUID()` for id generation
    - `add()` method validates rootPath is absolute: contains check for path starting with `/` or matching `/^[a-zA-Z]:\\/`
    - `persist()` method calls `vscode.workspace.fs.writeFile`
    - `persist()` method calls `vscode.workspace.fs.createDirectory` before writing
    - Registry file path is `vscode.Uri.joinPath(context.globalStorageUri, 'workspaces.json')`
    - `onDidChange` is typed as `vscode.Event<WorkspaceRecord[]>`
    - src/registry/index.ts contains `export { WorkspaceRegistry }`
    - `npx tsc --project tsconfig.extension.json --noEmit` exits 0
  </acceptance_criteria>
  <done>WorkspaceRegistry persists workspace records as JSON at globalStorageUri. Add, remove, and update operations work and fire change events. Absolute path validation prevents silent misresolution.</done>
</task>

<task type="auto">
  <name>Task 2: Implement FileWatcherManager, SecretStore, and wire into extension.ts</name>
  <files>src/watchers/FileWatcherManager.ts, src/watchers/index.ts, src/secrets/SecretStore.ts, src/secrets/index.ts, src/extension.ts</files>
  <read_first>
    - src/types/workspace.ts (WorkspaceRecord — watcher needs rootPath)
    - src/registry/WorkspaceRegistry.ts (API surface — subscribe to onDidChange)
    - src/extension.ts (current state — adding registry, watcher, and secret store initialization)
    - .planning/research/SUMMARY.md (RelativePattern with absolute base, context.secrets)
  </read_first>
  <action>
**src/watchers/FileWatcherManager.ts:**

Class `FileWatcherManager` manages one `vscode.FileSystemWatcher` per workspace.

Constructor takes `vscode.ExtensionContext`.

Private `Map<string, vscode.FileSystemWatcher>` keyed by workspace id.

Methods:
- `watchWorkspace(workspace: WorkspaceRecord): void` — create a `FileSystemWatcher` using `new vscode.RelativePattern(vscode.Uri.file(workspace.rootPath), '**/*')`. Subscribe to `onDidChange`, `onDidCreate`, `onDidDelete`. All three handlers call a debounced `onWorkspaceFileChanged(workspaceId)` method. Debounce: 500ms using a `Map<string, NodeJS.Timeout>` of pending timers per workspace. Store watcher in the map. Push watcher disposable to `context.subscriptions`.
- `unwatchWorkspace(workspaceId: string): void` — dispose the watcher, remove from map, clear any pending debounce timer.
- `onDidWorkspaceChange` — `vscode.EventEmitter<string>` that fires workspace id when debounced file change detected. Expose `.event`.
- `dispose(): void` — dispose all watchers.

**src/secrets/SecretStore.ts:**

Class `SecretStore` wraps `vscode.SecretStorage`.

Constructor takes `context.secrets` (type `vscode.SecretStorage`).

Methods:
- `getApiKey(provider: string): Promise<string | undefined>` — calls `this.secrets.get('harnesstune.apiKey.' + provider)`
- `setApiKey(provider: string, value: string): Promise<void>` — calls `this.secrets.store('harnesstune.apiKey.' + provider, value)`
- `deleteApiKey(provider: string): Promise<void>` — calls `this.secrets.delete('harnesstune.apiKey.' + provider)`

Key prefix is always `harnesstune.apiKey.` to namespace within context.secrets.

**Update src/extension.ts:**

In `activate()`:
1. Instantiate `WorkspaceRegistry` with context, call `await registry.load()` (make load public or add an `initialize()` method)
2. Instantiate `FileWatcherManager` with context
3. Instantiate `SecretStore` with `context.secrets`
4. Subscribe to `registry.onDidChange` — when workspaces change, sync watchers: add watchers for new workspaces, remove watchers for deleted ones
5. On initial load, create watchers for all existing workspaces
6. Wire `harnesstune.connectWorkspace` command: prompt user with `vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Connect Workspace' })`, then prompt for name with `vscode.window.showInputBox({ prompt: 'Workspace name', placeHolder: 'My Agent Workspace' })`, then call `registry.add(name, selectedPath)`
7. Wire `harnesstune.removeWorkspace` command: show QuickPick of current workspaces (label: name, description: rootPath), call `registry.remove(selectedId)` on selection
8. Push all disposables to `context.subscriptions`
9. In `deactivate()`, the subscription disposal handles cleanup automatically

Barrel files: `src/watchers/index.ts` exports `FileWatcherManager`, `src/secrets/index.ts` exports `SecretStore`.
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npx tsc --project tsconfig.extension.json --noEmit && node esbuild.mjs && test -f dist/extension.js && echo "ALL OK"</automated>
  </verify>
  <acceptance_criteria>
    - src/watchers/FileWatcherManager.ts contains `new vscode.RelativePattern(vscode.Uri.file(` — uses RelativePattern with absolute base
    - src/watchers/FileWatcherManager.ts contains debounce logic with 500ms timeout (setTimeout with 500)
    - src/watchers/FileWatcherManager.ts exports `FileWatcherManager` class with `watchWorkspace`, `unwatchWorkspace`, `dispose` methods
    - src/secrets/SecretStore.ts contains `context.secrets` or `SecretStorage` — never references `globalState`
    - src/secrets/SecretStore.ts uses key prefix `harnesstune.apiKey.`
    - src/extension.ts imports and instantiates WorkspaceRegistry, FileWatcherManager, SecretStore
    - src/extension.ts `harnesstune.connectWorkspace` command uses `showOpenDialog` with `canSelectFolders: true`
    - src/extension.ts `harnesstune.removeWorkspace` command uses `showQuickPick`
    - `npx tsc --project tsconfig.extension.json --noEmit` exits 0
    - `node esbuild.mjs` exits 0 and dist/extension.js exists
  </acceptance_criteria>
  <done>Registry, file watchers, and secret store are implemented and wired into extension activation. Connect/Remove workspace commands work via folder picker and quick pick. File watchers use RelativePattern with absolute base paths. Secrets use context.secrets with namespaced keys.</done>
</task>

</tasks>

<verification>
- `npx tsc --project tsconfig.extension.json --noEmit` passes
- `node esbuild.mjs` builds successfully
- dist/extension.js contains WorkspaceRegistry, FileWatcherManager, SecretStore code
- grep confirms: no reference to `globalState` for API key storage in SecretStore
- grep confirms: `RelativePattern` used in FileWatcherManager, not string globs
- grep confirms: rootPath validation checks for absolute path
</verification>

<success_criteria>
- Workspace registry persists to globalStorageUri/workspaces.json as JSON
- Connect command opens folder picker, prompts for name, adds to registry
- Remove command shows quick pick, removes selected workspace
- File watchers created per workspace using RelativePattern with absolute base
- Secrets stored via context.secrets with harnesstune.apiKey.* prefix
- Everything compiles and bundles
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-extension-scaffold-registry-sidebar/01-02-SUMMARY.md`
</output>
