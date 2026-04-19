# Phase 5: Workspace Scaffolding + OpenClaw Adapter — Patterns

**Generated:** 2026-04-19
**Phase:** 05 — Workspace Scaffolding + OpenClaw Adapter
**Requirements:** WKSP-02 (scaffold), ADPT-01 groundwork (OpenClaw adapter)

---

## File Inventory

### Files to Create

| File | Role |
|------|------|
| `src/adapters/AdapterFactory.ts` | Interface definitions: `AdapterFactory`, `WorkspaceConnectionConfig` |
| `src/adapters/AdapterRegistry.ts` | `Map<backendType, AdapterFactory>` singleton, factory lookup + creation |
| `src/adapters/OpenClawAdapter.ts` | chokidar-based JSONL watcher, byte-offset parser, normalizer |
| `src/types/openclaw.ts` | `OpenClawEvent` interface (HarnessTune integration spec) |
| `src/session/OpenClawLogSession.ts` | Read-only JSONL tail for chat panel (replaces `ClaudeSession` for OpenClaw workspaces) |
| `src/scaffold/ScaffoldService.ts` | Template discovery, `{{VAR}}` substitution, file copy |
| `src/scaffold/index.ts` | Re-export barrel |
| `resources/templates/claude-code-basic/template.json` | Manifest for Claude Code starter template |
| `resources/templates/claude-code-basic/CLAUDE.md` | Template file with `{{VAR}}` tokens |
| `resources/templates/claude-code-basic/harnesstune.json` | Template file with `{{VAR}}` tokens |
| `resources/templates/openclaw-basic/template.json` | Manifest for OpenClaw starter template |
| `resources/templates/openclaw-basic/CLAUDE.md` | Template file with `{{VAR}}` tokens |
| `resources/templates/multi-agent/template.json` | Manifest for multi-agent starter template |
| `resources/templates/multi-agent/CLAUDE.md` | Template file with `{{VAR}}` tokens |
| `resources/templates/multi-agent/roles/README.md` | Roles subdirectory placeholder |
| `tests/adapters/OpenClawAdapter.test.ts` | Unit tests: normalizeEvent, byte-offset parsing, type mapping |
| `tests/adapters/AdapterRegistry.test.ts` | Unit tests: factory registration, unknown backendType error |
| `tests/scaffold/ScaffoldService.test.ts` | Unit tests: manifest parsing, variable substitution, file creation |

### Files to Modify

| File | Change |
|------|--------|
| `src/types/workspace.ts` | Add `BackendType`, `backendType`, `connectionConfig` to `WorkspaceRecord` and `IWorkspaceRegistry.add()` signature |
| `src/registry/WorkspaceRegistry.ts` | Migration default in `load()`, updated `add()` to accept `backendType` |
| `src/adapters/index.ts` | Re-export `AdapterFactory`, `AdapterRegistry`, `OpenClawAdapter` |
| `src/session/index.ts` | Re-export `OpenClawLogSession` |
| `src/panels/ChatManager.ts` | Route by `backendType` in `openChat()` — `openclaw` → `OpenClawLogSession` |
| `src/extension.ts` | Replace single `adapter` with `adapterRegistry` + `activeAdapters` map; add `harnesstune.createWorkspace` command; add `harnesstune.configureWorkspace` command |

---

## Pattern 1: AdapterFactory Interface + AdapterRegistry

### Closest Analog

`src/adapters/ClaudeCodeHookAdapter.ts` — the class being wrapped by a factory.
`src/registry/WorkspaceRegistry.ts` — shows the pattern of a registry class with a `Map` backing store and idempotent operations.

### What It Does

`AdapterFactory.ts` defines two interfaces. `AdapterRegistry.ts` holds a `Map<string, AdapterFactory>` and exposes `register()` and `create()`. `extension.ts` calls `register()` twice at activation — once for `'claude-code'` (singleton factory returning the existing `ClaudeCodeHookAdapter` instance) and once for `'openclaw'` (creates a new `OpenClawAdapter` per workspace).

### Code to Write

**`src/adapters/AdapterFactory.ts`** — extracted directly from RESEARCH.md Pattern 1:

```typescript
import type { AgentBackendAdapter } from './AgentBackendAdapter';

export type BackendType = 'claude-code' | 'openclaw';

export interface WorkspaceConnectionConfig {
  backendType: BackendType;
  host: string;        // defaults to 'localhost' — remote-ready field
  port?: number;       // optional; adapter may use a default
  authToken?: string;  // from SecretStore at call time, NOT stored in WorkspaceRecord
}

export interface AdapterFactory {
  createAdapter(config: WorkspaceConnectionConfig): AgentBackendAdapter;
}
```

**`src/adapters/AdapterRegistry.ts`**:

```typescript
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AdapterFactory, WorkspaceConnectionConfig } from './AdapterFactory';

export class AdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  register(backendType: string, factory: AdapterFactory): void {
    this.factories.set(backendType, factory);
  }

  create(config: WorkspaceConnectionConfig): AgentBackendAdapter {
    const factory = this.factories.get(config.backendType);
    if (!factory) {
      throw new Error(`No adapter factory registered for backendType: ${config.backendType}`);
    }
    return factory.createAdapter(config);
  }
}
```

### extension.ts Refactor

Replace the single `const adapter = new ClaudeCodeHookAdapter(...)` block (currently at line 173) with:

```typescript
// Replace single adapter with factory registry + per-workspace active map
const adapterRegistry = new AdapterRegistry();
const claudeCodeAdapter = new ClaudeCodeHookAdapter(context.globalStorageUri);
adapterRegistry.register('claude-code', { createAdapter: () => claudeCodeAdapter });
adapterRegistry.register('openclaw', { createAdapter: () => new OpenClawAdapter() });

const activeAdapters = new Map<string, AgentBackendAdapter>();

async function connectWorkspace(workspace: WorkspaceRecord): Promise<void> {
  if (activeAdapters.has(workspace.id)) { return; } // idempotent
  const config: WorkspaceConnectionConfig = {
    backendType: workspace.backendType ?? 'claude-code',
    host: workspace.connectionConfig?.host ?? 'localhost',
    port: workspace.connectionConfig?.port,
  };
  const adapter = adapterRegistry.create(config);
  const sub = adapter.onDidReceiveEvent((event: AgentEvent) => handleEvent(event));
  context.subscriptions.push(sub);
  await adapter.connect(workspace.id, workspace.rootPath);
  activeAdapters.set(workspace.id, adapter);
  context.subscriptions.push(adapter);
}
```

The existing `onAdapterEvent` block (lines 194–241) becomes the `handleEvent` function extracted inline. The existing auto-connect loop at lines 597–609 is replaced by iterating `registry.getAll()` and calling `connectWorkspace(ws)`.

**Critical:** `claudeCodeAdapter.setPauseChecker(...)` call (line 183) must remain — applied to the Claude Code adapter instance before registering.

---

## Pattern 2: WorkspaceRecord Schema Extension + Migration

### Closest Analog

`src/types/workspace.ts` — the existing interface being extended.
`src/registry/WorkspaceRegistry.ts` `load()` method (lines 17–43) — where the migration default is applied.

### What to Add to `src/types/workspace.ts`

```typescript
export type BackendType = 'claude-code' | 'openclaw';

// In WorkspaceRecord — add after errorCount:
backendType: BackendType;           // required after Phase 5; migrated to 'claude-code' for old records
connectionConfig?: {
  host?: string;                    // remote-ready; defaults to 'localhost' in adapter
  port?: number;
};
```

Update `IWorkspaceRegistry.add()` signature:

```typescript
add(name: string, rootPath: string, backendType?: BackendType): Promise<WorkspaceRecord>;
```

### What to Add to `WorkspaceRegistry.load()` (line 25)

```typescript
// After: this.workspaces = data.workspaces;
this.workspaces = data.workspaces.map(ws => ({
  ...ws,
  backendType: ws.backendType ?? 'claude-code',  // migration default
}));
```

### What to Add to `WorkspaceRegistry.add()` (line 60)

Accept `backendType` parameter and include it in the `record` object:

```typescript
public async add(name: string, rootPath: string, backendType: BackendType = 'claude-code'): Promise<WorkspaceRecord> {
  // ... existing validation ...
  const record: WorkspaceRecord = {
    id: crypto.randomUUID(),
    name,
    rootPath,
    status: 'unknown',
    addedAt: now,
    lastUpdatedAt: now,
    runningAgentCount: 0,
    errorCount: 0,
    backendType,                    // NEW
  };
  // ... rest unchanged ...
}
```

---

## Pattern 3: OpenClawAdapter — chokidar JSONL Watcher

### Closest Analog

`src/adapters/ClaudeCodeHookAdapter.ts` — implements the same `AgentBackendAdapter` interface; `connect()` / `disconnect()` / `onDidReceiveEvent` / `normalizeEvent()` / `dispose()` structure is identical to follow.

`src/terminal/StreamJsonParser.ts` — `feed()` method shows the pattern of line-splitting + try/catch JSON.parse + silently skipping bad lines. `OpenClawAdapter.readIncremental()` does the same but with a byte offset instead of a string buffer.

### Key Structural Difference from ClaudeCodeHookAdapter

`ClaudeCodeHookAdapter` uses a shared singleton server (all workspaces connect to one port). `OpenClawAdapter` creates one `chokidar.FSWatcher` per workspace call to `connect()` and stores it in `this.watchers: Map<workspaceId, FSWatcher>`.

### `src/types/openclaw.ts`

```typescript
/**
 * HarnessTune OpenClaw Integration Spec — v1
 *
 * OpenClaw agents must write JSONL events to:
 *   ~/.harnesstune/openclaw/<agentId>/events.jsonl
 *
 * Each line must be a valid JSON object matching this interface.
 */
export interface OpenClawEvent {
  type: string;           // 'session_start' | 'tool_use' | 'tool_result' | 'session_end'
  agent_id: string;       // unique per agent instance; used as sessionId
  timestamp: string;      // ISO 8601
  data?: Record<string, unknown>;  // event-specific payload
}
```

### `src/adapters/OpenClawAdapter.ts` — Structure

```typescript
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'vscode';
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AgentEvent, AgentEventType } from '../types/agent';
import type { OpenClawEvent } from '../types/openclaw';

export class OpenClawAdapter implements AgentBackendAdapter {
  readonly id = 'openclaw';
  readonly name = 'OpenClaw';

  private readonly _onDidReceiveEvent = new EventEmitter<AgentEvent>();
  readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

  private watchers = new Map<string, chokidar.FSWatcher>();
  private offsets = new Map<string, number>();  // absolute filePath → last byte offset

  async connect(workspaceId: string, _workspaceRootPath: string): Promise<void> {
    if (this.watchers.has(workspaceId)) { return; } // idempotent
    const watchDir = path.join(os.homedir(), '.harnesstune', 'openclaw');
    const pattern = path.join(watchDir, '**', 'events.jsonl');

    const watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: false,            // emit 'add' for existing files at start
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on('add', (filePath) => this.readIncremental(workspaceId, filePath));
    watcher.on('change', (filePath) => this.readIncremental(workspaceId, filePath));

    this.watchers.set(workspaceId, watcher);
  }

  async disconnect(workspaceId: string): Promise<void> {
    const watcher = this.watchers.get(workspaceId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(workspaceId);
    }
  }

  // readIncremental: reads from last known byte offset to EOF
  // Mirrors StreamJsonParser.feed() line-splitting pattern but uses byte offset
  // instead of a string accumulation buffer
  private readIncremental(workspaceId: string, filePath: string): void { ... }

  // normalizeEvent: maps OpenClawEvent → AgentEvent
  // Type mapping table: session_start→SessionStart, session_end→SessionEnd,
  //   tool_use→PreToolUse, tool_result→PostToolUse; unknown→SessionStart + console.warn
  normalizeEvent(workspaceId: string, raw: OpenClawEvent): AgentEvent { ... }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close().catch(() => {});
    }
    this._onDidReceiveEvent.dispose();
  }
}
```

### normalizeEvent Type Mapping

Mirror pattern of `ClaudeCodeHookAdapter.normalizeEvent()` (lines 141–176) but with a lookup table for string→`AgentEventType`:

```typescript
const typeMap: Record<string, AgentEventType> = {
  session_start: 'SessionStart',
  session_end: 'SessionEnd',
  tool_use: 'PreToolUse',
  tool_result: 'PostToolUse',
};
const eventType = typeMap[raw.type] ?? 'SessionStart';
if (!typeMap[raw.type]) {
  console.warn('OpenClawAdapter: unknown event type, defaulting to SessionStart:', raw.type);
}
```

### Fallback Agent ID — Mirror of ClaudeCodeHookAdapter line 158

```typescript
const agentId = raw.agent_id || `openclaw-${crypto.randomUUID()}`;
```

---

## Pattern 4: OpenClawLogSession — Read-Only Chat Tail

### Closest Analog

`src/session/ClaudeSession.ts` — the interface callers expect. `ChatManager.openChat()` (lines 48–90) shows how a session's `'message'`, `'stateChange'`, `'agentEvent'` event names are consumed. `OpenClawLogSession` must emit the same event names so `ChatManager` can wire it identically.

### ChatManager Routing Change

In `src/panels/ChatManager.ts`, the `openChat()` method (line 41) currently creates `new ClaudeSession(...)` unconditionally. Add a `registry` or `backendType` lookup before that:

```typescript
openChat(
  workspaceId: string,
  workspaceName: string,
  workspaceRootPath: string,
  options?: ChatManagerOpenOptions,
  backendType: BackendType = 'claude-code',  // new parameter
): void {
  if (!this.entries.has(workspaceId)) {
    const session = backendType === 'openclaw'
      ? new OpenClawLogSession(workspaceId, workspaceName, workspaceRootPath)
      : new ClaudeSession(workspaceId, workspaceName, workspaceRootPath, {
          dangerouslySkipPermissions: options?.dangerouslySkipPermissions,
        });
    // ... rest of wiring unchanged ...
  }
  // ...
}
```

### OpenClawLogSession Events

Must emit the same Node.js EventEmitter events as `ClaudeSession`:
- `'message'` with `ChatMessage` payload — format each JSONL line as a chat-style message
- `'stateChange'` with `SessionState` — `'active'` after connect, `'ended'` on dispose
- `'agentEvent'` with `AgentEvent` — emitted for each parsed JSONL line (feeds the event pipeline)

Send `chat:setReadOnly` panel message to disable textarea:

```typescript
// In ChatManager.switchToWorkspace(), after sending history:
if (backendType === 'openclaw') {
  panel.postMessage({
    type: 'chat:setReadOnly',
    reason: "Log viewer — this workspace doesn't support interactive chat.",
  });
}
```

The `sendMessage()` method on `OpenClawLogSession` should be a no-op (log viewer has no input).

---

## Pattern 5: ScaffoldService — Template Discovery + Variable Substitution

### Closest Analog

No direct existing analog in the codebase. The closest structural match is `WorkspaceRegistry.load()` (lines 17–43), which uses `vscode.workspace.fs.readFile()` + `JSON.parse()` for registry loading from a URI. `ScaffoldService.listTemplates()` uses the same `vscode.workspace.fs` API for reading manifests.

The `showOpenDialog` + `showInputBox` UX already exists in the `connectCmd` block in `src/extension.ts` (lines 54–85) — the scaffold command extends this pattern with a preceding `showQuickPick` and a multi-step `showInputBox` loop.

### `src/scaffold/ScaffoldService.ts` — Key Methods

```typescript
export interface TemplateManifest {
  name: string;
  description: string;
  backendType: 'claude-code' | 'openclaw';
  variables: string[];  // variables to prompt the user for (CREATED_DATE is auto-injected)
  files: string[];      // relative paths within the template directory to copy
}

export class ScaffoldService {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async listTemplates(): Promise<Array<{ name: string; manifest: TemplateManifest }>> {
    const templatesUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'templates');
    const entries = await vscode.workspace.fs.readDirectory(templatesUri);
    // For each Directory entry, read template.json and parse
    // Same vscode.workspace.fs.readFile() + Buffer.from().toString() pattern as WorkspaceRegistry.load()
  }

  substitute(content: string, vars: Record<string, string>): string {
    // Simple regex — no external template engine
    return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  async scaffold(
    templateName: string,
    manifest: TemplateManifest,
    targetDir: string,
    vars: Record<string, string>,
  ): Promise<string[]> {
    const allVars = { ...vars, CREATED_DATE: new Date().toISOString() };
    // For each file in manifest.files:
    //   1. Read from extensionUri/resources/templates/<templateName>/<relPath>
    //   2. Apply substitute()
    //   3. Write to targetDir/<relPath> using vscode.workspace.fs.writeFile()
    //   4. Create parent directories via vscode.workspace.fs.createDirectory()
    // Return array of absolute destination paths
  }
}
```

### harnesstune.createWorkspace Command (extension.ts)

The scaffold command follows the same async guard pattern as `connectCmd` (lines 54–85) — bail with `return` on any `undefined` from VSCode pickers. Full flow:

```typescript
const createWorkspaceCmd = vscode.commands.registerCommand(
  'harnesstune.createWorkspace',
  async () => {
    const scaffoldService = new ScaffoldService(context.extensionUri);
    const templates = await scaffoldService.listTemplates();

    // Step 1: QuickPick template
    const templateItems = templates.map(t => ({
      label: t.manifest.name,
      description: t.manifest.description,
      templateName: t.name,
      manifest: t.manifest,
    }));
    const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
      placeHolder: 'Select a workspace template',
    });
    if (!selectedTemplate) { return; }

    // Step 2: Multi-step InputBox per declared variable
    const vars: Record<string, string> = {};
    for (const varName of selectedTemplate.manifest.variables) {
      const value = await vscode.window.showInputBox({
        prompt: `Enter value for ${varName}`,
        placeHolder: varName === 'MODEL' ? 'claude-opus-4-5' : varName.toLowerCase(),
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; } // user cancelled
      vars[varName] = value;
    }

    // Step 3: Pick or create target directory
    const folderUris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select Workspace Folder',
    });
    if (!folderUris || folderUris.length === 0) { return; }
    const targetDir = folderUris[0].fsPath;

    // Step 4: Conflict check (Pitfall 5)
    // Check if any manifest files already exist in targetDir; warn before overwriting

    // Step 5: Scaffold
    await scaffoldService.scaffold(selectedTemplate.templateName, selectedTemplate.manifest, targetDir, vars);

    // Step 6: Register + connect (mirrors connectCmd lines 76–83 + connectWorkspace())
    const name = vars['AGENT_NAME'] ?? path.basename(targetDir);
    const record = await registry.add(name, targetDir, selectedTemplate.manifest.backendType);
    watcherManager.watchWorkspace(record);
    await connectWorkspace(record);

    // Step 7: Open dashboard
    DashboardPanel.createOrShow(context.extensionUri);

    vscode.window.showInformationMessage(`HarnessTune: Workspace "${name}" created.`);
  }
);
```

---

## Pattern 6: Template Files

### `resources/templates/claude-code-basic/template.json`

```json
{
  "name": "Claude Code Agent",
  "description": "Single Claude Code agent workspace",
  "backendType": "claude-code",
  "variables": ["AGENT_NAME", "AGENT_ROLE", "MODEL"],
  "files": ["CLAUDE.md", "harnesstune.json"]
}
```

### `resources/templates/claude-code-basic/CLAUDE.md`

```markdown
# {{AGENT_NAME}}

**Role:** {{AGENT_ROLE}}
**Model:** {{MODEL}}
**Created:** {{CREATED_DATE}}

## Instructions

You are {{AGENT_NAME}}, acting as {{AGENT_ROLE}}.
```

### `resources/templates/openclaw-basic/template.json`

```json
{
  "name": "OpenClaw Agent",
  "description": "Single OpenClaw agent workspace — events streamed from ~/.harnesstune/openclaw/",
  "backendType": "openclaw",
  "variables": ["AGENT_NAME", "AGENT_ROLE"],
  "files": ["CLAUDE.md"]
}
```

### `resources/templates/multi-agent/template.json`

```json
{
  "name": "Multi-Agent Workspace",
  "description": "Multi-agent workspace with roles directory",
  "backendType": "claude-code",
  "variables": ["AGENT_NAME", "AGENT_ROLE", "MODEL"],
  "files": ["CLAUDE.md", "roles/README.md"]
}
```

---

## Pattern 7: Test Files

### `tests/adapters/OpenClawAdapter.test.ts` — Structure

Follow `tests/adapters/ClaudeCodeHookAdapter.test.ts` exactly:
- `describe('OpenClawAdapter', ...)` block
- `beforeEach` / `afterEach` with `fs.mkdtempSync` temp dir (for JSONL fixture files)
- Mock chokidar via `jest.mock('chokidar')` returning an EventEmitter-like object with `.on()`, `.close()`

Key test cases:
```typescript
it('normalizeEvent — maps session_start to SessionStart')
it('normalizeEvent — maps tool_use to PreToolUse')
it('normalizeEvent — unknown type defaults to SessionStart with console.warn')
it('normalizeEvent — missing agent_id generates openclaw-<uuid> fallback')
it('readIncremental — reads only new bytes from offset')
it('readIncremental — skips partial lines that fail JSON.parse')
it('connect — idempotent: second connect call does not start second watcher')
```

### `tests/adapters/AdapterRegistry.test.ts`

```typescript
describe('AdapterRegistry', ...)
it('register + create — returns adapter from registered factory')
it('create — throws for unknown backendType')
it('create — claude-code factory singleton: two create() calls return same instance')
```

### `tests/scaffold/ScaffoldService.test.ts`

Use Node.js `path.join(__dirname, '../../resources/templates')` for reading actual bundled templates (not `vscode.workspace.fs` — tests run in Node, not extension host):

```typescript
describe('ScaffoldService', ...)
it('substitute — replaces {{VAR}} tokens')
it('substitute — leaves unknown {{TOKENS}} unchanged')
it('scaffold — creates files with substituted content in target directory')
it('listTemplates — discovers all three bundled templates')
```

### `tests/registry/WorkspaceRegistry.test.ts` — Extension (existing file)

Add to the existing test suite:

```typescript
it('load — existing records without backendType default to claude-code')
it('add — accepts backendType parameter and stores it in record')
```

---

## Data Flow Summary

```
harnesstune.createWorkspace command
  → ScaffoldService.listTemplates()        reads resources/templates/*/template.json
  → vscode.window.showQuickPick()          user picks template
  → vscode.window.showInputBox() × N       user fills variables
  → vscode.window.showOpenDialog()         user picks target folder
  → ScaffoldService.scaffold()             copies files with {{VAR}} substitution
  → registry.add(name, path, backendType)  creates WorkspaceRecord (includes backendType)
  → watcherManager.watchWorkspace()        attaches FileSystemWatcher
  → connectWorkspace(record)               adapterRegistry.create() → adapter.connect()
  → DashboardPanel.createOrShow()          opens dashboard

OpenClaw event pipeline:
  chokidar 'add'/'change' on ~/.harnesstune/openclaw/<agentId>/events.jsonl
  → OpenClawAdapter.readIncremental()      byte-offset read, line split, try/catch JSON.parse
  → OpenClawAdapter.normalizeEvent()       OpenClawEvent → AgentEvent
  → _onDidReceiveEvent.fire(event)         same AgentEvent type as ClaudeCodeHookAdapter
  → handleEvent() in extension.ts          same pipeline: store, notify, push to dashboard/schematic
```

---

## Critical Pitfalls (from RESEARCH.md)

| Pitfall | Guard |
|---------|-------|
| Multiple HookServer ports (one per Claude Code adapter instance) | `ClaudeCodeAdapterFactory.createAdapter()` returns the same `ClaudeCodeHookAdapter` singleton every call |
| chokidar v5 ESM in CJS bundle | esbuild handles interop automatically with `bundle: true` + `format: 'cjs'`; run `npm run build` immediately after install to validate |
| `backendType: undefined` from old registry JSON causes factory lookup failure | Apply `ws.backendType ?? 'claude-code'` in both `registry.load()` and `connectWorkspace()` |
| Scaffold overwrites existing files silently | Check for existing files before writing; show `showWarningMessage('Overwrite?')` if conflicts found |
| Partial JSONL line at byte boundary causes parse failure | `awaitWriteFinish: { stabilityThreshold: 200 }` prevents mid-write reads; secondary: try/catch JSON.parse skips bad lines; offset advances to EOF regardless |
| VSCode `FileSystemWatcher` unreliable outside workspace root | Always use chokidar for `~/.harnesstune/openclaw/` paths |

---

## Index of Codebase Analogs Referenced

| New File | Primary Analog |
|----------|---------------|
| `AdapterFactory.ts` | `src/adapters/AgentBackendAdapter.ts` (interface pattern) |
| `AdapterRegistry.ts` | `src/registry/WorkspaceRegistry.ts` (Map-backed registry) |
| `OpenClawAdapter.ts` | `src/adapters/ClaudeCodeHookAdapter.ts` (full adapter shape) |
| `OpenClawAdapter.readIncremental()` | `src/terminal/StreamJsonParser.ts` `feed()` (line-split + try/catch) |
| `src/types/openclaw.ts` | `src/types/agent.ts` (typed interface pattern) |
| `OpenClawLogSession.ts` | `src/session/ClaudeSession.ts` (EventEmitter session shape) |
| `ScaffoldService.ts` | `src/registry/WorkspaceRegistry.ts` `load()` (vscode.workspace.fs reads) |
| `harnesstune.createWorkspace` command | `harnesstune.connectWorkspace` command in `src/extension.ts` lines 54–85 |
| ChatManager `backendType` routing | `src/panels/ChatManager.ts` `openChat()` lines 41–90 |
| `tests/adapters/OpenClawAdapter.test.ts` | `tests/adapters/ClaudeCodeHookAdapter.test.ts` (test structure + temp dir pattern) |

---

*Patterns documented: 2026-04-19*
