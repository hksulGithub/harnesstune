# Phase 5: Workspace Scaffolding + OpenClaw Adapter — Research

**Researched:** 2026-04-19
**Domain:** VSCode extension — template scaffolding, adapter factory pattern, chokidar JSONL tailing
**Confidence:** HIGH (all findings grounded in existing codebase + locked decisions from CONTEXT.md)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Template Storage — Bundled in Extension**
Templates ship bundled at `resources/templates/<templateName>/`. Not in user home dir. Ship 3 starter templates: `claude-code-basic`, `openclaw-basic`, `multi-agent`.

**D-02: Template Format — JSON Manifest + Raw Files with {{VAR}} Substitution**
Each template directory contains a `template.json` manifest declaring name, description, backendType, variables list, and files list. Template files use `{{VAR}}` tokens. Variables: `AGENT_NAME`, `AGENT_ROLE`, `MODEL` (prompted), `CREATED_DATE` (auto-injected ISO 8601), `BACKEND_HOST`/`BACKEND_PORT` (schema-ready, not exposed in v1 UX).

**D-03: Scaffold UX — QuickPick + Multi-Step InputBox**
Flow: `showQuickPick()` for template → `showInputBox()` sequence per variable declared in manifest → `showOpenDialog({ canSelectFolders: true })` for root → scaffold + register + open dashboard.

**D-04: Post-Scaffold Flow**
After scaffolding: validate files, `registry.add()` with extended fields, attach FileSystemWatcher, connect adapter via factory, open dashboard panel, workspace appears in sidebar.

**D-05: Multi-Adapter Routing — Factory Registry, One Instance Per Workspace**
Extension changes from one shared `ClaudeCodeHookAdapter` to one adapter instance per workspace. `AdapterFactory` interface + `WorkspaceConnectionConfig`. `Map<string, AdapterFactory>` in extension.ts. Factory lookup by `backendType` on connect.

**D-06: WorkspaceRecord Schema Extension**
Add `backendType: 'claude-code' | 'openclaw'` (required) and `connectionConfig?: { host?: string; port?: number }` (optional). `authToken` stays in SecretStore, not WorkspaceRecord. Migration: existing records without `backendType` default to `'claude-code'`.

**D-07: OpenClaw Integration — Local chokidar Watcher, Our Own JSONL Contract**
Path convention: `~/.harnesstune/openclaw/<agentId>/events.jsonl` — defined by us. chokidar (new production dependency) with `awaitWriteFinish` for append-heavy files. Incremental parsing via byte offset. Remote mode deferred (throws "not yet supported").

**D-08: OpenClaw Event Schema**
`src/types/openclaw.ts` defines `OpenClawEvent { type, agent_id, timestamp, data? }`. `normalizeEvent()` maps to `AgentEvent`. Unknown types logged and skipped, not crashed.

**D-09: Agent Identity — Use Backend Session IDs**
No new identity scheme. OpenClaw: `agent_id` from JSONL; fallback `openclaw-${crypto.randomUUID()}`. Display unchanged.

**D-10: Chat Backend Routing — Read-Only Log Viewer for OpenClaw v1**
`ChatManager.openChat()` routes by `backendType`. OpenClaw gets `OpenClawLogSession` (read-only tail). Input textarea disabled with "Log viewer — this workspace doesn't support interactive chat."

**D-11: Scope Boundary — Local-Only v1, Remote-Ready Interfaces**
In scope: template scaffolding, adapter factory registry, `WorkspaceConnectionConfig` schema, local chokidar watcher, OpenClaw log viewer, "Configure Workspace" command.
Explicitly deferred: remote event monitoring, remote chat, `harnesstune.allowRemoteConnections`, user-configurable templates, OpenClaw interactive chat.

**D-12: Dependency — chokidar**
Add chokidar as a production dependency. Latest version: 5.0.0 (confirmed via npm).

### Claude's Discretion
(None declared — all areas covered by explicit decisions)

### Deferred Ideas (OUT OF SCOPE)
- Remote workspace connections → 999.1
- User-defined template directory → AWKSP-02
- OpenClaw interactive chat → ACHAT-03
- Template marketplace/sharing → v2+
- Auto-detect backend type from workspace files → v2+
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WKSP-02 | User can create a new workspace from a scaffold template | D-01 through D-04 map the full scaffold flow; VSCode QuickPick/InputBox API patterns documented below |
| ADPT-01 (groundwork) | OpenClaw adapter via JSONL file tailing | D-07 through D-10 define the full adapter design; chokidar API patterns documented below |
</phase_requirements>

---

## Summary

Phase 5 has two independent tracks that can be developed in parallel: (1) workspace scaffolding — a multi-step VSCode UX flow that copies bundled template files with variable substitution then wires into the existing registry/watcher/adapter infrastructure; (2) OpenClaw adapter — a chokidar-based JSONL tail that normalizes events into the existing `AgentEvent` schema, proving the adapter pattern generalizes.

The most architecturally significant change is **D-05**: the extension currently uses one shared `ClaudeCodeHookAdapter` for all workspaces. Phase 5 refactors this to a per-workspace adapter factory model. This refactor touches `extension.ts` directly and is a prerequisite for both the scaffolded OpenClaw workspace and for correct multi-workspace Claude Code isolation.

The extension already has `StreamJsonParser` for incremental JSONL parsing and `FileWatcherManager` for workspace-relative watching. The OpenClaw adapter reuses the first pattern (byte-offset tracking) and parallels the second (but with chokidar for paths outside the workspace root). No new webview panels are needed.

**Primary recommendation:** Implement in three sequential waves — (1) WorkspaceRecord schema migration + adapter factory refactor, (2) template scaffolding UX + scaffold command, (3) OpenClawAdapter + OpenClawLogSession. Each wave has clear entry/exit criteria.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vscode API | ^1.96.0 | QuickPick, InputBox, showOpenDialog, commands | Already the host |
| TypeScript | ^5.6.0 | Type-safe adapter + manifest parsing | Project standard |
| Node.js fs | built-in | Template file copying, atomic writes | Extension host only |
| Node.js crypto | built-in | `randomUUID()` for fallback agent IDs | Already used in ClaudeCodeHookAdapter |
| Node.js os | built-in | `os.homedir()` for OpenClaw path | Already used in ClaudeCodeHookAdapter |

### New Dependency
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| chokidar | 5.0.0 | Watch `~/.harnesstune/openclaw/` JSONL files for changes | VSCode FileSystemWatcher does not reliably watch files outside workspace root; chokidar provides `awaitWriteFinish` for append-heavy files; ~40M weekly npm downloads; D-12 locked |

### No New Devdependencies Needed
Jest test patterns already established. chokidar mocking via `jest.mock('chokidar')`.

**Installation:**
```bash
npm install chokidar@5
```

**esbuild.mjs update required:** chokidar must NOT be in the `external` array (unlike `vscode` and `sql.js`) — it should be bundled into `dist/extension.js`. The extension host is Node.js, so chokidar's Node.js file system APIs work. Verify chokidar v5 ships ESM-only; esbuild handles ESM-to-CJS interop automatically when `format: 'cjs'` and `bundle: true`.

---

## Architecture Patterns

### Recommended Project Structure Changes
```
src/
├── adapters/
│   ├── AgentBackendAdapter.ts        # (existing) — no changes
│   ├── AdapterFactory.ts             # NEW — AdapterFactory interface + WorkspaceConnectionConfig
│   ├── AdapterRegistry.ts            # NEW — Map<backendType, AdapterFactory> singleton
│   ├── ClaudeCodeHookAdapter.ts      # (existing) — wraps in ClaudeCodeAdapterFactory
│   ├── OpenClawAdapter.ts            # NEW — chokidar watcher + JSONL parser
│   └── index.ts                      # re-export all
├── types/
│   ├── openclaw.ts                   # NEW — OpenClawEvent interface (D-08)
│   ├── workspace.ts                  # MODIFY — add backendType + connectionConfig to WorkspaceRecord
│   └── ...
├── session/
│   ├── ClaudeSession.ts              # (existing)
│   ├── OpenClawLogSession.ts         # NEW — read-only JSONL tail for chat log viewer
│   └── index.ts
├── scaffold/
│   ├── ScaffoldService.ts            # NEW — template discovery, variable substitution, file copy
│   └── index.ts
resources/
├── templates/
│   ├── claude-code-basic/
│   │   ├── template.json
│   │   ├── CLAUDE.md                 # {{AGENT_NAME}}, {{AGENT_ROLE}}, {{MODEL}}
│   │   └── harnesstune.json
│   ├── openclaw-basic/
│   │   ├── template.json
│   │   └── CLAUDE.md
│   └── multi-agent/
│       ├── template.json
│       ├── CLAUDE.md
│       └── roles/
│           └── README.md
```

### Pattern 1: Adapter Factory Registry

**What:** Map from `backendType` string to factory object. Extension.ts uses the registry to create adapter instances per workspace on connect.

**When to use:** When a new backend type is added — register one factory, extension.ts routing logic unchanged.

```typescript
// src/adapters/AdapterFactory.ts
export interface WorkspaceConnectionConfig {
  backendType: 'claude-code' | 'openclaw';
  host: string;      // defaults to 'localhost'
  port?: number;
  authToken?: string; // from SecretStore, not WorkspaceRecord
}

export interface AdapterFactory {
  createAdapter(config: WorkspaceConnectionConfig): AgentBackendAdapter;
}

// src/adapters/AdapterRegistry.ts
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

**extension.ts refactor:** Replace the single shared `adapter` with `adapterRegistry` + `Map<workspaceId, AgentBackendAdapter>`:

```typescript
const adapterRegistry = new AdapterRegistry();
adapterRegistry.register('claude-code', new ClaudeCodeAdapterFactory(context.globalStorageUri));
adapterRegistry.register('openclaw', new OpenClawAdapterFactory());

const activeAdapters = new Map<string, AgentBackendAdapter>();

async function connectWorkspace(workspace: WorkspaceRecord): Promise<void> {
  if (activeAdapters.has(workspace.id)) { return; } // idempotent
  const config: WorkspaceConnectionConfig = {
    backendType: workspace.backendType ?? 'claude-code',
    host: workspace.connectionConfig?.host ?? 'localhost',
    port: workspace.connectionConfig?.port,
  };
  const adapter = adapterRegistry.create(config);
  // wire event pipeline (same as existing onAdapterEvent handler)
  const sub = adapter.onDidReceiveEvent(event => handleEvent(event));
  context.subscriptions.push(sub);
  await adapter.connect(workspace.id, workspace.rootPath);
  activeAdapters.set(workspace.id, adapter);
  context.subscriptions.push(adapter);
}
```

**Key concern:** The existing `ClaudeCodeHookAdapter` is currently a singleton that holds the `HookServer`. Per-workspace instances each starting their own server would open multiple ports. Solution: `ClaudeCodeAdapterFactory` creates one `HookServer` shared across all Claude Code adapter instances (or the factory creates only one `ClaudeCodeHookAdapter` and returns it each time — idempotent since `connect()` already guards against duplicate starts via `serverStarted` flag).

The cleanest approach: `ClaudeCodeAdapterFactory` holds the single `ClaudeCodeHookAdapter` instance and returns it from `createAdapter()` every time (singleton per factory). Multi-workspace routing inside `ClaudeCodeHookAdapter` already uses `connectedWorkspaces` set.

### Pattern 2: Template Scaffolding

**What:** `ScaffoldService` reads bundled templates, prompts user via VSCode API, substitutes `{{VAR}}` tokens, copies files to target directory.

**When to use:** On `harnesstune.createWorkspace` command execution.

```typescript
// src/scaffold/ScaffoldService.ts
export interface TemplateManifest {
  name: string;
  description: string;
  backendType: 'claude-code' | 'openclaw';
  variables: string[];  // variables to prompt for (not CREATED_DATE — that's auto)
  files: string[];      // relative paths within template dir
}

export class ScaffoldService {
  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Discover all bundled templates by reading resources/templates/<name>/template.json */
  async listTemplates(): Promise<Array<{ name: string; manifest: TemplateManifest }>> {
    const templatesUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'templates');
    const entries = await vscode.workspace.fs.readDirectory(templatesUri);
    const results = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) { continue; }
      const manifestUri = vscode.Uri.joinPath(templatesUri, name, 'template.json');
      const raw = await vscode.workspace.fs.readFile(manifestUri);
      const manifest = JSON.parse(Buffer.from(raw).toString('utf-8')) as TemplateManifest;
      results.push({ name, manifest });
    }
    return results;
  }

  /** Substitute {{VAR}} tokens in a string */
  substitute(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  /** Copy all template files to targetDir with variable substitution applied */
  async scaffold(
    templateName: string,
    manifest: TemplateManifest,
    targetDir: string,
    vars: Record<string, string>,
  ): Promise<string[]> {
    const allVars = { ...vars, CREATED_DATE: new Date().toISOString() };
    const templatesUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'templates', templateName);
    const created: string[] = [];

    for (const relPath of manifest.files) {
      const srcUri = vscode.Uri.joinPath(templatesUri, relPath);
      const raw = await vscode.workspace.fs.readFile(srcUri);
      const content = this.substitute(Buffer.from(raw).toString('utf-8'), allVars);
      const destUri = vscode.Uri.file(path.join(targetDir, relPath));
      // Ensure parent directories exist
      const parentDir = vscode.Uri.file(path.dirname(destUri.fsPath));
      await vscode.workspace.fs.createDirectory(parentDir);
      await vscode.workspace.fs.writeFile(destUri, Buffer.from(content, 'utf-8'));
      created.push(destUri.fsPath);
    }

    return created;
  }
}
```

**Note:** Use `vscode.workspace.fs` (not Node.js `fs`) for reading template files — it works with `extensionUri` which may be a virtual URI in some VSCode hosts.

### Pattern 3: OpenClawAdapter with chokidar

**What:** Per-workspace chokidar watcher on `~/.harnesstune/openclaw/<agentId>/events.jsonl`. Incremental byte-offset parsing. Normalizes to `AgentEvent`.

```typescript
// src/adapters/OpenClawAdapter.ts
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'vscode';
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AgentEvent } from '../types/agent';
import type { OpenClawEvent } from '../types/openclaw';

export class OpenClawAdapter implements AgentBackendAdapter {
  readonly id = 'openclaw';
  readonly name = 'OpenClaw';

  private readonly _onDidReceiveEvent = new EventEmitter<AgentEvent>();
  readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

  private watchers = new Map<string, chokidar.FSWatcher>();
  private offsets = new Map<string, number>();  // file path → last byte offset

  async connect(workspaceId: string, _workspaceRootPath: string): Promise<void> {
    const watchDir = path.join(os.homedir(), '.harnesstune', 'openclaw');
    const pattern = path.join(watchDir, '**', 'events.jsonl');

    const watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: false,
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

  private readIncremental(workspaceId: string, filePath: string): void {
    const offset = this.offsets.get(filePath) ?? 0;
    let fd: number | undefined;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= offset) { return; } // no new bytes

      fd = fs.openSync(filePath, 'r');
      const length = stat.size - offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, offset);
      this.offsets.set(filePath, stat.size);

      const chunk = buf.toString('utf-8');
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { continue; }
        try {
          const raw = JSON.parse(trimmed) as OpenClawEvent;
          const event = this.normalizeEvent(workspaceId, raw);
          this._onDidReceiveEvent.fire(event);
        } catch {
          console.warn('OpenClawAdapter: failed to parse line:', trimmed);
        }
      }
    } catch (err) {
      console.error('OpenClawAdapter: readIncremental error:', err);
    } finally {
      if (fd !== undefined) { fs.closeSync(fd); }
    }
  }

  normalizeEvent(workspaceId: string, raw: OpenClawEvent): AgentEvent {
    const agentId = raw.agent_id || `openclaw-${crypto.randomUUID()}`;
    const timestamp = raw.timestamp ? Date.parse(raw.timestamp) || Date.now() : Date.now();

    // Map OpenClaw event types to AgentEventType
    const typeMap: Record<string, import('../types/agent').AgentEventType> = {
      session_start: 'SessionStart',
      session_end: 'SessionEnd',
      tool_use: 'PreToolUse',
      tool_result: 'PostToolUse',
    };
    const eventType = typeMap[raw.type] ?? 'SessionStart';
    if (!typeMap[raw.type]) {
      console.warn('OpenClawAdapter: unknown event type, defaulting to SessionStart:', raw.type);
    }

    return {
      id: crypto.randomUUID(),
      workspaceId,
      sessionId: agentId,
      agentId,
      eventType,
      timestamp,
      raw,
    };
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close().catch(() => {});
    }
    this._onDidReceiveEvent.dispose();
  }
}
```

### Pattern 4: WorkspaceRecord Migration

**What:** Existing `WorkspaceRecord` objects in `workspaces.json` lack `backendType`. On registry load, migrate in-memory (not by rewriting disk format version — just apply defaults when field is absent).

```typescript
// In WorkspaceRegistry.load() — after parsing:
this.workspaces = data.workspaces.map(ws => ({
  ...ws,
  backendType: ws.backendType ?? 'claude-code',  // migration default
}));
```

**WorkspaceRecord extension:**
```typescript
// src/types/workspace.ts additions
export type BackendType = 'claude-code' | 'openclaw';

export interface WorkspaceRecord {
  // ... existing fields ...
  backendType: BackendType;           // required after Phase 5; defaults on migration
  connectionConfig?: {
    host?: string;                    // default: 'localhost'
    port?: number;
  };
}
```

### Pattern 5: OpenClawLogSession (Read-Only Chat)

**What:** Implements the same session interface as `ClaudeSession` but tails the JSONL file and formats events as chat messages. Input is disabled.

```typescript
// ChatManager routing:
openChat(workspaceId: string, ...) {
  const ws = registry.getById(workspaceId);
  const backendType = ws?.backendType ?? 'claude-code';

  if (backendType === 'openclaw') {
    // Create OpenClawLogSession instead of ClaudeSession
    const session = new OpenClawLogSession(workspaceId, workspaceName, workspaceRootPath);
    // ...
  } else {
    // existing ClaudeSession path
  }
}
```

**Panel message:** Send `{ type: 'chat:setReadOnly', reason: "Log viewer — this workspace doesn't support interactive chat." }` to disable the input textarea in the webview.

### Anti-Patterns to Avoid

- **Creating a new HookServer per Claude Code adapter instance:** The server binds a port. Only one per extension host. `ClaudeCodeAdapterFactory` must return the same adapter instance (or the factory holds the server).
- **Using VSCode `FileSystemWatcher` for `~/.harnesstune/openclaw/` paths:** It only reliably watches paths within a VSCode workspace folder. chokidar is the correct tool for arbitrary absolute paths.
- **Reading entire JSONL file on every change event:** Use byte offsets. JSONL files grow by append; only read from last known offset.
- **Storing `authToken` in `WorkspaceRecord`:** Goes in `SecretStore` keyed by `workspaceId`. `WorkspaceRecord` is written to disk as plain JSON.
- **Crashing on unknown OpenClaw event types:** Log and skip. The integration spec is user-controlled, so new event types will appear.
- **Prompting for `BACKEND_HOST`/`BACKEND_PORT` in v1 scaffold UX:** These fields are in the schema for remote-readiness but not exposed in v1. Set defaults silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watching outside workspace root | Custom `setInterval` + `stat()` polling | chokidar | Handles debounce, cross-platform quirks, `awaitWriteFinish` for append-heavy files |
| Template variable substitution engine | Full template language (Handlebars, Mustache) | Simple `String.replace(/\{\{(\w+)\}\}/g, ...)` | The declared variable set is small and fixed; a regex is sufficient and has zero dependencies |
| Template discovery | Hardcoded template list | `vscode.workspace.fs.readDirectory()` on `resources/templates/` | Lets future templates be added without code changes |
| Multi-step VSCode wizard | Custom webview wizard | `showQuickPick` + sequential `showInputBox` | Native VSCode pattern; "yo code generator" style; handles cancellation at any step automatically |

---

## Common Pitfalls

### Pitfall 1: chokidar v5 is ESM-only
**What goes wrong:** `require('chokidar')` fails with "ERR_REQUIRE_ESM" because chokidar v5 dropped CJS.
**Why it happens:** The extension bundle is CJS (`format: 'cjs'`). esbuild must interop ESM→CJS at bundle time.
**How to avoid:** esbuild handles this automatically when `bundle: true` and `format: 'cjs'` — it statically analyzes and inlines the ESM module. No special flag needed. Confirm build succeeds by running `npm run build` after `npm install chokidar@5`.
**Warning signs:** Build error mentioning `require()` of ES Module, or runtime `ERR_REQUIRE_ESM`.

### Pitfall 2: Template Files Not Accessible via vscode.workspace.fs
**What goes wrong:** `vscode.workspace.fs.readFile(extensionUri + '/resources/templates/...')` fails in test or packaged extension.
**Why it happens:** `extensionUri` may be a virtual URI scheme in some environments.
**How to avoid:** Use `vscode.Uri.joinPath(context.extensionUri, 'resources', 'templates', ...)` consistently. For tests, use the actual `__dirname`-relative path. In production, `context.extensionUri` is always set correctly.
**Alternative:** For tests, Node.js `fs` with `path.join(__dirname, '../../resources/templates')` works since tests run in Node.

### Pitfall 3: Adapter Factory Creates Multiple HookServer Instances
**What goes wrong:** Each call to `createAdapter()` for `claude-code` creates a new `ClaudeCodeHookAdapter`, each starts its own `HookServer` on the same port, causing EADDRINUSE on the second workspace connect.
**Why it happens:** `ClaudeCodeHookAdapter` constructor creates `HookServer`. If factory creates new adapter per workspace, multiple servers try to bind.
**How to avoid:** `ClaudeCodeAdapterFactory` holds a single `ClaudeCodeHookAdapter` instance and returns it from every `createAdapter()` call. The existing `connectedWorkspaces` set inside the adapter handles per-workspace routing.

### Pitfall 4: WorkspaceRecord `backendType` Field Missing on Deserialization
**What goes wrong:** Old registry JSON doesn't have `backendType`. TypeScript typing says it's required. Runtime `undefined` causes factory lookup to fail with "No adapter factory registered for backendType: undefined".
**Why it happens:** Migration only applied to in-memory objects but code path uses raw deserialized data.
**How to avoid:** Apply migration in `registry.load()` with `ws.backendType ?? 'claude-code'`. Also guard in `connectWorkspace()`: `workspace.backendType ?? 'claude-code'`.

### Pitfall 5: Scaffold Overwrites Existing Files Without Warning
**What goes wrong:** User accidentally runs "Create Workspace" on an existing populated directory. Template files overwrite their work.
**Why it happens:** `vscode.workspace.fs.writeFile()` does not check for existing files by default.
**How to avoid:** Before scaffolding, check if any of the manifest's `files` already exist in the target directory. If conflicts found, show `showWarningMessage` with "Overwrite?" confirmation. Or: recommend user select an empty or new directory; detect non-empty target and warn.

### Pitfall 6: chokidar `awaitWriteFinish` Delays First Event
**What goes wrong:** New JSONL file appears, but chokidar emits `add` only after `stabilityThreshold` ms of no writes. If agent writes one line and stops, the event arrives 200ms late. This is acceptable but confusing during testing.
**Why it happens:** `awaitWriteFinish` waits for the file size to stabilize.
**How to avoid:** Set `stabilityThreshold: 200` (not higher). Document in code that first event may be slightly delayed. This is a feature, not a bug — prevents partial-line reads.

### Pitfall 7: JSONL Partial Line at Byte Boundary
**What goes wrong:** Reading from byte offset to EOF grabs a partial last line (no trailing `\n`). Parser attempts `JSON.parse()` on the partial line and fails.
**Why it happens:** Agent process writes one line at a time but the OS buffer may flush mid-write.
**How to avoid:** With `awaitWriteFinish`, the file is stable before the change event fires — partial writes are avoided. As a secondary defense, the incremental reader splits on `\n` and skips empty lines; a partial line that fails `JSON.parse` is logged and skipped (not crashed). The offset is still advanced to EOF, so the partial bytes are re-read on the next change event and will form a complete line.

---

## Code Examples

### Multi-Step InputBox Flow (Scaffold UX)
```typescript
// Collect all variables declared in manifest
const vars: Record<string, string> = {};
for (const varName of manifest.variables) {
  const value = await vscode.window.showInputBox({
    prompt: `Enter value for ${varName}`,
    placeHolder: varName === 'MODEL' ? 'claude-opus-4-5' : varName.toLowerCase(),
    ignoreFocusOut: true,  // prevents dismissal when user switches window
  });
  if (value === undefined) {
    return;  // user cancelled — bail entire scaffold flow
  }
  vars[varName] = value;
}
```

### Template Manifest Example (resources/templates/claude-code-basic/template.json)
```json
{
  "name": "Claude Code Agent",
  "description": "Single Claude Code agent workspace",
  "backendType": "claude-code",
  "variables": ["AGENT_NAME", "AGENT_ROLE", "MODEL"],
  "files": ["CLAUDE.md", "harnesstune.json"]
}
```

### Template File Example (resources/templates/claude-code-basic/CLAUDE.md)
```markdown
# {{AGENT_NAME}}

**Role:** {{AGENT_ROLE}}
**Model:** {{MODEL}}
**Created:** {{CREATED_DATE}}

## Instructions

You are {{AGENT_NAME}}, acting as {{AGENT_ROLE}}.
```

### chokidar Watch Setup
```typescript
// From chokidar v5 docs — persistent watcher with write stabilization
const watcher = chokidar.watch(pattern, {
  persistent: true,
  ignoreInitial: false,    // emit 'add' for existing files on start
  awaitWriteFinish: {
    stabilityThreshold: 200,  // ms file size must be stable
    pollInterval: 50,          // ms between size polls
  },
});
watcher.on('add', handler);
watcher.on('change', handler);
// Always close on disconnect:
await watcher.close();
```

### Adapter Factory Registration in extension.ts
```typescript
// Replace single adapter with factory registry
const adapterRegistry = new AdapterRegistry();
const claudeCodeAdapter = new ClaudeCodeHookAdapter(context.globalStorageUri);
adapterRegistry.register('claude-code', {
  createAdapter: () => claudeCodeAdapter,  // singleton factory
});
adapterRegistry.register('openclaw', {
  createAdapter: () => new OpenClawAdapter(),  // one per workspace
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One shared adapter for all workspaces | One adapter instance per workspace via factory | Phase 5 | Required for OpenClaw (separate JSONL path per workspace) and for future remote instances |
| No template system | Bundled templates with manifest + {{VAR}} | Phase 5 | Users can scaffold in one command |
| Claude Code only | Multi-backend via factory registry | Phase 5 | Adapter pattern proven with OpenClaw; adding ADPT-02/03 in v2 is just new factory registration |

**Deprecated/outdated after Phase 5:**
- Single `const adapter = new ClaudeCodeHookAdapter(...)` in extension.ts — replaced by `adapterRegistry` + `activeAdapters` map
- `chatManager.openChat()` hardcoded to `ClaudeSession` — must route by `backendType`

---

## Open Questions

1. **chokidar v5 ESM bundling with esbuild CJS target**
   - What we know: esbuild is known to handle ESM→CJS interop at bundle time. The existing build already handles `d3-hierarchy` (pure ESM) by adding it to `transformIgnorePatterns` in jest and bundling normally with esbuild.
   - What's unclear: Whether chokidar v5 has any native Node.js addon (`fsevents` on macOS) that requires special handling.
   - Recommendation: After `npm install chokidar@5`, run `npm run build` immediately. If it fails, add `chokidar` to the `external` array and ship it unbundled (requires adding it to `bundledDependencies` in package.json). `fsevents` is an optional peer dep — chokidar falls back to polling if unavailable.

2. **"Configure Workspace" command scope**
   - What we know: D-11 says this command is in scope. It allows changing `backendType` post-creation.
   - What's unclear: Whether this just writes `backendType` to the registry record, or also needs to disconnect the old adapter and connect the new one.
   - Recommendation: On backendType change — call `activeAdapters.get(workspaceId)?.disconnect()`, remove from map, call `connectWorkspace(updatedRecord)` with new type. Include this in the scaffold plan as a sub-task.

3. **Test mocking strategy for chokidar**
   - What we know: Jest already mocks `vscode` via `moduleNameMapper`. chokidar exports a `watch()` function returning an FSWatcher-like object.
   - Recommendation: `jest.mock('chokidar')` with a mock that returns an EventEmitter with `.on()`, `.close()`. Same pattern as how `HookServer` tests mock the underlying HTTP server.

---

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json` — treat as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest |
| Config file | `/Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune/jest.config.js` |
| Quick run command | `cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npm test` |
| Full suite command | `cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npm test -- --verbose` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WKSP-02 | Template manifest parsing + {{VAR}} substitution | unit | `npm test -- --testPathPattern=ScaffoldService` | ❌ Wave 0 |
| WKSP-02 | Post-scaffold: validate files created, registry.add called | unit | `npm test -- --testPathPattern=ScaffoldService` | ❌ Wave 0 |
| WKSP-02 | WorkspaceRecord migration: missing backendType defaults to claude-code | unit | `npm test -- --testPathPattern=WorkspaceRegistry` | ❌ Wave 0 (extend existing test) |
| ADPT-01 | OpenClawAdapter.normalizeEvent: type mapping, agent_id fallback | unit | `npm test -- --testPathPattern=OpenClawAdapter` | ❌ Wave 0 |
| ADPT-01 | OpenClawAdapter incremental parsing: byte offset tracking, partial line safety | unit | `npm test -- --testPathPattern=OpenClawAdapter` | ❌ Wave 0 |
| ADPT-01 | AdapterRegistry: factory registration, unknown backendType throws | unit | `npm test -- --testPathPattern=AdapterRegistry` | ❌ Wave 0 |
| ADPT-01 + WKSP-02 | End-to-end scaffold → register → adapter connect flow | manual smoke | Extension host + F5 debugger | manual-only |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test -- --verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/scaffold/ScaffoldService.test.ts` — covers WKSP-02 manifest parsing and substitution
- [ ] `tests/adapters/OpenClawAdapter.test.ts` — covers ADPT-01 normalizeEvent, incremental parsing
- [ ] `tests/adapters/AdapterRegistry.test.ts` — covers factory registration and error on unknown type
- [ ] Extend `tests/adapters/ClaudeCodeHookAdapter.test.ts` — verify singleton factory pattern doesn't create multiple HookServers
- [ ] Extend `tests/registry/WorkspaceRegistry.test.ts` (if it exists) or create it — verify backendType migration

---

## Sources

### Primary (HIGH confidence)
- Existing codebase (read directly): `src/adapters/AgentBackendAdapter.ts`, `ClaudeCodeHookAdapter.ts`, `src/types/workspace.ts`, `src/types/agent.ts`, `src/terminal/StreamJsonParser.ts`, `src/watchers/FileWatcherManager.ts`, `src/extension.ts`, `src/registry/WorkspaceRegistry.ts`, `esbuild.mjs`, `package.json`, `jest.config.js`
- CONTEXT.md (05-CONTEXT.md): 12 locked decisions, fully read
- npm registry: chokidar latest version confirmed as 5.0.0 via `npm show chokidar version`

### Secondary (MEDIUM confidence)
- chokidar v5 ESM-only nature: well-known in the Node.js ecosystem; esbuild ESM→CJS interop is documented esbuild behavior

### Tertiary (LOW confidence)
- chokidar v5 `fsevents` optional dependency behavior: based on general knowledge of chokidar's architecture; not verified against v5 changelog directly. Validate after install.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core libraries are already in the project; only new addition is chokidar (version confirmed)
- Architecture: HIGH — all patterns are derived from locked decisions in CONTEXT.md and existing code patterns
- Pitfalls: HIGH for items grounded in existing code (adapter singleton, migration, byte offset); MEDIUM for chokidar ESM bundling (confirm on first build)

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable decisions; chokidar version check may need refresh if major version bump)
