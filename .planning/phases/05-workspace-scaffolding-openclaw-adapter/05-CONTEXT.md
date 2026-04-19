# Phase 5 Context: Workspace Scaffolding + OpenClaw Adapter

**Created:** 2026-04-19
**Phase Goal:** Users can scaffold a new workspace from a template with a single command, and OpenClaw agent events flow into the dashboard, proving the adapter pattern generalizes beyond Claude Code.
**Requirements:** WKSP-02, plus OpenClaw adapter groundwork (anticipates ADPT-01)

---

## Prior Context Applied

Decisions from Phases 2-4 that constrain Phase 5:

- **AgentBackendAdapter interface** (Phase 2, D-04): `id`, `name`, `connect()`, `disconnect()`, `onDidReceiveEvent` — OpenClaw adapter implements this directly
- **AgentEvent schema** (Phase 2, D-05): OTel-aligned, backend-agnostic — no changes needed for OpenClaw
- **SecretStore for secrets** (Phase 1): Auth tokens stored via `context.secrets`, never in workspace JSON
- **sql.js for event storage** (Phase 2): OpenClaw events flow into the same `AgentEventStore`
- **ClaudeCodeHookAdapter.normalizeEvent()** (Phase 2): Reference pattern for OpenClaw's normalizer
- **One acquireVsCodeApi() per webview** (Phase 1): No new webviews in Phase 5 — sidebar and dashboard already exist

---

## Decisions

### D-01: Template Storage — Bundled in Extension

Templates ship bundled at `resources/templates/<templateName>/`. Not in user home dir.

**Why:** Extension-bundled templates are version-controlled with the extension, always available on first use, no discovery complexity. User-configurable templates (`~/.harnesstune/templates/`) deferred to v2 (AWKSP-02 export/import).

**Ship 2-3 starter templates:**
- `claude-code-basic` — Single Claude Code agent workspace
- `openclaw-basic` — Single OpenClaw agent workspace
- `multi-agent` — Multi-agent workspace with roles directory

### D-02: Template Format — JSON Manifest + Raw Files with {{VAR}} Substitution

Each template directory contains a `template.json` manifest:

```json
{
  "name": "Claude Code Agent",
  "description": "Single Claude Code agent workspace",
  "backendType": "claude-code",
  "variables": ["AGENT_NAME", "AGENT_ROLE", "MODEL"],
  "files": ["claude.md", "harnesstune.json"]
}
```

Template files use `{{VAR}}` substitution. The manifest declares which files to copy and which variables to prompt for.

**Variables:**
- `AGENT_NAME` — prompted
- `AGENT_ROLE` — prompted
- `MODEL` — prompted (with sensible default per backend)
- `CREATED_DATE` — auto-injected (ISO 8601), not prompted
- `BACKEND_HOST` — defaults to `localhost`, not exposed in v1 scaffold UX (remote-ready field)
- `BACKEND_PORT` — optional, adapter may use default, not exposed in v1

### D-03: Scaffold UX — QuickPick + Multi-Step InputBox

Selection flow:
1. `vscode.window.showQuickPick()` with template name + description
2. Multi-step `showInputBox()` sequence collects variable values declared in manifest
3. `showOpenDialog({ canSelectFolders: true })` for workspace root (or create new)
4. Scaffold files, register workspace, attach watcher, show in sidebar

Matches VSCode conventions (yo code generator pattern).

### D-04: Post-Scaffold Flow

After scaffolding:
1. Validate all template files created successfully
2. Register workspace in registry via `registry.add()` with extended fields (backendType)
3. Attach `FileSystemWatcher` via existing `FileWatcherManager`
4. Connect adapter (via factory lookup)
5. Open dashboard panel automatically
6. Workspace appears in sidebar immediately

### D-05: Multi-Adapter Routing — Factory Registry, One Instance Per Workspace

**Architecture change from current:** Extension currently creates one shared `ClaudeCodeHookAdapter` and connects all workspaces to it. Phase 5 changes to one adapter instance per workspace.

```typescript
interface AdapterFactory {
  createAdapter(config: WorkspaceConnectionConfig): AgentBackendAdapter;
}

interface WorkspaceConnectionConfig {
  backendType: 'claude-code' | 'openclaw';
  host: string;        // defaults to 'localhost' — remote-ready
  port?: number;       // optional, adapter may use default
  authToken?: string;  // stored in SecretStore, not workspace JSON
}
```

- `Map<string, AdapterFactory>` in extension.ts: `registerAdapterFactory('claude-code', claudeFactory)`, `registerAdapterFactory('openclaw', openclawFactory)`
- On workspace connect: look up factory by `backendType`, create adapter instance, call `adapter.connect()`
- `backendType` set at scaffold time (from template's `backendType`), editable post-creation via "Configure Workspace" command

**Why one per workspace:** Remote instances (v2) need separate connections per host. Even locally, isolating adapter state per workspace prevents cross-workspace side effects.

### D-06: WorkspaceRecord Schema Extension

Add to `WorkspaceRecord`:

```typescript
backendType: 'claude-code' | 'openclaw';  // required, set at scaffold time
connectionConfig?: {                       // optional, remote-ready
  host?: string;                           // default: 'localhost'
  port?: number;
};
```

`authToken` NOT stored in `WorkspaceRecord` — goes in `SecretStore` keyed by `workspaceId`.

Migration: Existing workspaces without `backendType` default to `'claude-code'`.

### D-07: OpenClaw Integration — Local chokidar Watcher, Our Own JSONL Contract

**Path convention:** `~/.harnesstune/openclaw/<agentId>/events.jsonl` — defined by us, not dependent on OpenClaw's internal file structure.

**Why our own path:** OpenClaw's internal structure may change. Our integration spec tells users "configure your OpenClaw output to write here." If OpenClaw later publishes an official schema, we add a mapping layer in `normalizeEvent()`.

**File watcher:** `chokidar` (add as dependency). VSCode's `FileSystemWatcher` is designed for workspace-relative patterns and has quirks with files outside the workspace root. The JSONL files live in `~/.harnesstune/openclaw/`, which is outside any VSCode workspace. chokidar provides reliable change events with `awaitWriteFinish` for append-heavy files.

**Incremental parsing:** Same pattern as `StreamJsonParser` (already at `src/terminal/StreamJsonParser.ts`). Maintain byte offset per file. On change event, read from last offset to EOF, split by `\n`, parse each complete line as JSON, buffer partial lines.

**Remote mode:** Interface designed for it (`startRemotePoller()` branch), but implementation throws "Remote not yet supported" in v1. When 999.1 lands, fill in HTTP polling without restructuring.

### D-08: OpenClaw Event Schema — HarnessTune Integration Spec

Define `src/types/openclaw.ts` with a generic JSONL contract:

```typescript
interface OpenClawEvent {
  type: string;           // e.g., 'session_start', 'tool_use', 'session_end'
  agent_id: string;       // unique per agent instance
  timestamp: string;      // ISO 8601
  data?: Record<string, unknown>;  // event-specific payload
}
```

The adapter's `normalizeEvent()` maps this to `AgentEvent`:
- `type` → `eventType` (with mapping table)
- `agent_id` → `sessionId` and `agentId`
- Unknown event types logged and skipped (not crash)

This becomes the "HarnessTune OpenClaw Integration Spec" — documented so OpenClaw users know the target format.

### D-09: Agent Identity — Use Backend Session IDs

No new identity scheme. Backends provide unique session IDs; our job is display.

- Claude Code: `agent_id` from hooks (already handled in `ClaudeCodeHookAdapter.normalizeEvent()`)
- OpenClaw: `agent_id` from JSONL events. If missing, adapter generates `openclaw-${crypto.randomUUID()}`
- Display: `agentRole-shortId` (e.g., `researcher-a3f2`) in topology graph and session list
- `TopologyNodeComponent` already truncates to 8 chars — no UI changes needed

### D-10: Chat Backend Routing — Read-Only Log Viewer for OpenClaw v1

`ClaudeSession` spawns `claude -p` — Claude Code specific. OpenClaw has no equivalent interactive CLI.

**Implementation:**
```typescript
// ChatManager.openChat() routes by backendType:
if (backendType === 'claude-code') {
  session = new ClaudeSession(workspace);      // interactive
} else if (backendType === 'openclaw') {
  session = new OpenClawLogSession(workspace);  // read-only tail
}
```

`OpenClawLogSession` tails the same JSONL files the adapter watches, formats events as chat-style messages. Input textarea disabled or shows "Log viewer — this workspace doesn't support interactive chat."

**v2 upgrade path:** If OpenClaw adds an interactive API, add `OpenClawChatSession` implementing the same session interface. ChatManager routing logic doesn't change.

### D-11: Scope Boundary — Local-Only v1, Remote-Ready Interfaces

**In scope for Phase 5 (v1):**
- Template scaffolding with bundled templates
- Adapter factory registry with per-workspace instances
- `WorkspaceConnectionConfig` with `host`/`port` fields (schema ready for remote)
- OpenClaw adapter with local chokidar watcher
- OpenClaw log viewer (read-only chat)
- "Configure Workspace" command for changing backendType

**Explicitly deferred:**
- Remote event monitoring (binding HookServer to 0.0.0.0, HTTP polling for OpenClaw) → 999.1
- Remote interactive chat (SSH tunneling, remote CLI proxy) → 999.1
- `harnesstune.allowRemoteConnections` setting → 999.1
- User-configurable templates at `~/.harnesstune/templates/` → AWKSP-02 (v2)
- OpenClaw interactive chat session → ACHAT-03 (v2)

### D-12: Dependency — chokidar

Add `chokidar` as a production dependency. It's a well-maintained, widely-used file watcher (~40M weekly npm downloads) that handles cross-platform edge cases VSCode's native watcher doesn't cover for external paths.

---

## Deferred Ideas

| Idea | Why Deferred | When |
|------|-------------|------|
| Remote workspace connections | Significant complexity (auth, network, security) | 999.1 |
| User-defined template directory | Discovery complexity; extension-bundled covers v1 | AWKSP-02 |
| OpenClaw interactive chat | No known CLI equivalent; needs OpenClaw API | ACHAT-03 |
| Template marketplace/sharing | Over-engineering for v1 | v2+ |
| Auto-detect backend type from workspace files | Nice-to-have; explicit selection is clearer | v2+ |

---

*Context captured: 2026-04-19*
*12 decisions across 5 discussion areas + scope boundary*
