# Workspace & State Management Research

**Project:** HarnessTune VSCode Extension
**Focus Area:** Workspace modeling, state persistence, agent health, panel layout, file watching
**Researched:** 2026-04-16
**Overall Confidence:** HIGH (VSCode API sections), MEDIUM (agent schema patterns), LOW (cmux internals)

---

## 1. VSCode Extension Storage APIs

VSCode provides five distinct storage mechanisms. Understanding their scope and limits is essential before choosing where to store workspace or agent state.

### Storage Tier Summary

| API | Scope | Synced | Best For |
|-----|-------|--------|---------|
| `context.workspaceState` | Per workspace | No | Open panel positions, active agent selection |
| `context.globalState` | All workspaces | Optional (via `setKeysForSync`) | User preferences, dismissed notifications |
| `context.storageUri` | Per workspace (filesystem) | No | Large per-workspace files, indexes |
| `context.globalStorageUri` | Global (filesystem) | No | Cross-workspace databases, agent registry |
| `context.secrets` | Global, encrypted | Never | API keys, auth tokens |

### Key Details

**`workspaceState` and `globalState`** are Memento (key-value) stores. VSCode internally stores them in an SQLite file (`state.vscdb`) in the workspace `.vscode` directory. They are simple JSON-serializable key-value pairs — not suited for relational queries or large structured datasets.

**`globalStorageUri`** is the right location for a self-managed SQLite or JSON database. It points to a directory like `~/.config/Code/User/globalStorage/<extension-id>/`. Extension has full read/write access. This is where HarnessTune should write its primary state database.

**`storageUri`** is workspace-local — use it for workspace-specific caches or derived data.

**`setKeysForSync`** on `globalState` allows selected keys to sync across machines via VSCode Settings Sync. Use sparingly — only for user preferences, never for machine-local paths or agent state.

**Recommendation for HarnessTune:**
- Store the workspace registry and agent metadata in a JSON or SQLite file at `globalStorageUri`
- Store active panel state (which workspace is open, which panels are visible) in `workspaceState`
- Store API keys and tokens in `context.secrets`
- Never store file paths in synced keys

**Confidence:** HIGH — sourced from official VSCode API documentation.

---

## 2. SQLite vs JSON for Local State

### The Core Decision

HarnessTune needs to persist structured state: workspace records, agent metadata, health metrics, token logs. The decision between SQLite and JSON depends on query complexity and data volume.

### Option A: JSON Files at `globalStorageUri`

**Use when:** State is simple, rarely queried relationally, and total size stays under ~1MB.

Pros:
- Zero dependencies
- Human-readable for debugging
- No native compilation issues
- Easy to serialize/deserialize TypeScript interfaces

Cons:
- No indexed queries (linear scan over agent list)
- Concurrent writes require locking logic
- Grows unwieldy as token history accumulates

**Recommended JSON structure for HarnessTune workspaces:**

```json
{
  "version": 2,
  "workspaces": {
    "<uuid>": {
      "id": "uuid-v4",
      "name": "Ethan Production",
      "rootPath": "/Users/hksul/.../agents/Ethan",
      "createdAt": "2026-04-16T00:00:00Z",
      "lastOpenedAt": "2026-04-16T12:00:00Z",
      "agents": ["ethan", "gavin"],
      "tags": ["production"],
      "color": "#4A90D9"
    }
  },
  "activeWorkspaceId": "uuid-v4"
}
```

### Option B: SQLite via `sql.js`

**Use when:** You need relational queries (e.g., "show agents with error rate > 5% this week"), token history grows unbounded, or you want aggregation without loading everything into memory.

**Why `sql.js` over `better-sqlite3`:**

`better-sqlite3` requires native C++ compilation and must be recompiled against VSCode's specific Electron/Node version. Developers report `NODE_MODULE_VERSION` mismatch errors that are difficult to resolve in extension packaging. `sql.js` compiles SQLite to WebAssembly — no native binaries, no compilation step, works in any Electron version.

Trade-offs of `sql.js`:
- Loads a ~1MB WASM binary on activation (acceptable for a management tool)
- In-memory by default — must manually serialize to disk (`db.export()` → write Buffer to `globalStorageUri`)
- Slightly more complex write pattern than `better-sqlite3`'s synchronous API

**`libsql`** is not appropriate here — it's designed for Turso serverless deployments, not local desktop extension use.

### Recommendation

Use a **two-layer approach**:

1. **JSON file** (`workspaces.json`) at `globalStorageUri` for the workspace registry and agent config. Small, rarely changes, no queries needed.
2. **`sql.js` SQLite database** (`harnesstune.db`) at `globalStorageUri` for agent health metrics, token logs, and cost tracking. Query-friendly, handles large time-series data.

Write the SQLite DB to disk after each write operation using `db.export()`. Load it once at extension activation.

**Confidence:** MEDIUM — based on multiple community sources and GitHub issue discussions. Native module issues with `better-sqlite3` confirmed by multiple independent reports.

---

## 3. Workspace Config Schema for Agent Systems

### What to Store Per Workspace

Drawing from the Claude Code `.claude/` folder conventions and multi-agent orchestration patterns, a HarnessTune workspace record should capture:

```typescript
interface WorkspaceRecord {
  // Identity
  id: string;                   // UUID v4, stable identifier
  name: string;                 // Display name ("Ethan Production")
  rootPath: string;             // Absolute filesystem path to agent root
  createdAt: string;            // ISO 8601
  lastOpenedAt: string;         // ISO 8601, for MRU sorting

  // Visual
  color?: string;               // Hex color for tab accent
  icon?: string;                // VS Codicons ID (e.g. "robot")

  // Agent inventory (resolved from disk at open time, cached here)
  agents: AgentRecord[];

  // Workspace-level config
  claudeMdPath?: string;        // Resolved path to root CLAUDE.md
  settingsJsonPath?: string;    // Resolved path to .claude/settings.json
  mcpConfigPath?: string;       // Resolved path to .mcp.json

  // Health snapshot (updated by file watcher + polling)
  healthSummary: {
    activeCount: number;
    errorCount: number;
    lastTokenBurn: number;       // tokens in last 24h
    lastCostUsd: number;         // USD in last 24h
  };

  // User metadata
  tags: string[];
  notes?: string;               // Free-text memo
  archived: boolean;
}
```

```typescript
interface AgentRecord {
  id: string;                   // "<workspace-id>/<agent-name>"
  name: string;                 // Directory or CLAUDE.md-derived name
  agentPath: string;            // Absolute path to agent directory
  claudeMdPath?: string;        // Path to agent's CLAUDE.md
  memoryPath?: string;          // Path to agent's MEMORY.md
  model?: string;               // Declared model (from CLAUDE.md frontmatter)
  status: "active" | "idle" | "error" | "unknown";
  lastHeartbeatAt?: string;     // Last detected filesystem activity
  errorMessage?: string;        // Last known error string
}
```

### What NOT to Store

- Full CLAUDE.md content — read on demand, do not cache in registry
- Agent conversation history — too large, not HarnessTune's concern
- Filesystem-derived data that changes frequently — derive at runtime, cache with TTL

**Confidence:** MEDIUM — schema design is original but grounded in Claude Code conventions and multi-agent framework patterns from Swarms and Microsoft Foundry.

---

## 4. Agent Health Monitoring Patterns

### Heartbeat Detection

Agents do not expose a network API in the Claude Code model. Health must be inferred from filesystem activity, not network pings.

**Practical heartbeat proxy — filesystem signals:**

| Signal | Location | Meaning |
|--------|----------|---------|
| MEMORY.md mtime | `~/.claude/projects/<hash>/memory/` | Agent was active (wrote memory) |
| work-log/*.md mtime | Agent workspace | Agent completed a session |
| `.claude/` file mtime | Agent root | Any agent activity |
| Error file presence | Configurable | Agent wrote error log |

Use `vscode.workspace.createFileSystemWatcher` with a `RelativePattern` pointing to each registered agent's directory. Fire health re-evaluation on `onDidChange` events.

**Polling fallback:** VSCode falls back to `fs.watchFile` polling (5s interval) if native file watching fails. Do not rely on sub-second heartbeat detection — design health status as "last seen within N minutes."

### Token and Cost Tracking

Token tracking requires a data source. Options for Claude Code agents:

1. **Parse MEMORY.md / work-logs** for token mentions (fragile, unreliable)
2. **Monitor Claude Code's own usage tracking** — Claude Code Usage Tracker extensions read from Claude's internal session logs
3. **Instrument via MCP** — if HarnessTune exposes an MCP server, agents can report token usage as structured events

The Microsoft VSCode Copilot team's approach uses OpenTelemetry with these metrics as the reference model:
- `gen_ai.client.token.usage` (histogram) — input + output tokens per LLM call
- `gen_ai.client.operation.duration` — call latency
- `copilot_chat.agent.turn.count` — LLM round-trips per invocation

For HarnessTune Phase 1, **manual input** (user enters observed token usage) is more reliable than automated parsing. Build the schema now, automate the ingestion later.

**SQL schema for token logs:**

```sql
CREATE TABLE token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,         -- ISO 8601
  input_tokens INTEGER,
  output_tokens INTEGER,
  model TEXT,
  cost_usd REAL,
  source TEXT                        -- 'manual' | 'mcp' | 'parsed'
);

CREATE INDEX idx_token_events_agent ON token_events(agent_id, recorded_at);
CREATE INDEX idx_token_events_workspace ON token_events(workspace_id, recorded_at);
```

**Error rate tracking:**

```sql
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,          -- 'heartbeat' | 'error' | 'session_start' | 'session_end'
  recorded_at TEXT NOT NULL,
  payload TEXT                       -- JSON blob for type-specific data
);
```

**Confidence:** MEDIUM — OTel metrics from official Copilot Chat monitoring docs are HIGH confidence. Application to Claude Code agents is extrapolated.

---

## 5. Multi-Panel Layout Persistence

### Two Persistence Layers

VSCode webviews offer two distinct persistence layers that must both be implemented:

**Layer 1: Within-session state (getState/setState)**

Inside the webview JavaScript, use the VSCode API to save panel layout state whenever it changes:

```javascript
const vscode = acquireVsCodeApi();

// Save
vscode.setState({
  activeWorkspaceId: "uuid",
  openPanels: ["agents", "health"],
  agentListScrollY: 240,
  selectedAgentId: "ethan"
});

// Restore
const state = vscode.getState();
if (state) restoreLayout(state);
```

This survives the webview becoming hidden/unfocused within a session. VSCode destroys and recreates webview DOM when hidden — this is the primary persistence mechanism.

**Layer 2: Cross-session serialization (WebviewPanelSerializer)**

To restore panels after VSCode restarts, register a serializer in the extension's `activate()`:

```typescript
context.subscriptions.push(
  vscode.window.registerWebviewPanelSerializer('harnesstune.workspace', {
    async deserializeWebviewPanel(panel, state) {
      // state = whatever was in setState() at last session
      HarnessTunePanel.restore(panel, state, context);
    }
  })
);
```

**Critical caveat:** There is a known VSCode bug (issue #240207) where webview state unexpectedly persists across sessions even without a registered serializer. Do not rely on this — always implement the serializer explicitly to guarantee correct behavior.

### Session ID Pattern for Stale State Detection

Embed a session ID in the webview HTML at render time:

```typescript
// Extension side — generate once per activation
const sessionId = crypto.randomUUID();

// Inject into webview HTML
html = html.replace('__SESSION_ID__', sessionId);
```

```javascript
// Webview side — check on restore
const savedState = vscode.getState();
if (savedState?.sessionId !== window.__SESSION_ID__) {
  // State is from a previous session — reset to defaults
  vscode.setState(defaultState);
}
```

### Panel Architecture for HarnessTune

Recommended panel decomposition:

| Panel | Type | Persistence |
|-------|------|-------------|
| Workspace Sidebar | TreeView (native) | `workspaceState` (active workspace ID) |
| Agent Dashboard | WebviewPanel | setState + Serializer |
| Health Monitor | WebviewView (sidebar) | setState |
| Token/Cost Log | WebviewPanel | setState + Serializer |
| Template Gallery | WebviewPanel | No persistence needed |

Use `vscode.window.createTreeView()` (not `registerTreeDataProvider`) for the workspace sidebar — it returns a `TreeView` handle that lets you programmatically expand, select, and add badges to items.

**Confidence:** HIGH — sourced from official VSCode Webview API documentation and verified against known bug reports.

---

## 6. Template System for Scaffolding New Agent Workspaces

### What to Scaffold

When a user creates a new agent workspace in HarnessTune, the extension should write a canonical directory structure. Based on Claude Code conventions:

```
<workspace-root>/
├── CLAUDE.md                       # Agent instructions (from template)
├── .claude/
│   ├── settings.json               # Permissions config
│   ├── settings.local.json         # (gitignored) personal overrides
│   ├── rules/                      # Modular instruction files
│   ├── skills/                     # Reusable workflows
│   └── agents/                     # Subagent persona files
├── context/
│   ├── project.md                  # What this workspace does
│   ├── role.md                     # Agent role definition
│   └── constraints.md              # What agent must not do
├── work-log/                       # Agent session logs (YYYY-MM-DD.md)
├── planning/                       # Active plans
└── user-docs/                      # Polished deliverables
```

### Template Implementation Strategy

Store templates as embedded TypeScript strings or as files in the extension's `resources/templates/` directory (bundled with the VSIX). Do not fetch templates from remote URLs at runtime — network failures should not block workspace creation.

Template variables to support:

```
{{AGENT_NAME}}          → "Ethan"
{{AGENT_ROLE}}          → "Business Manager"
{{CREATED_DATE}}        → "2026-04-16"
{{WORKSPACE_ID}}        → UUID
{{MODEL}}               → "claude-opus-4-6"
```

**Minimal CLAUDE.md template:**

```markdown
# {{AGENT_NAME}}

**Role:** {{AGENT_ROLE}}
**Created:** {{CREATED_DATE}}
**Model:** {{MODEL}}

## Instructions

[Fill in agent instructions here]

## Commands

- `/help` — list available commands
```

**Minimal `.claude/settings.json` template:**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": ["Read", "Write", "Bash(git *)"],
    "deny": ["Bash(rm -rf *)"]
  },
  "autoMemoryEnabled": true
}
```

### Validation After Scaffolding

After writing the workspace, immediately:
1. Verify all directories and files were created
2. Register the workspace in HarnessTune's registry
3. Add a `FileSystemWatcher` for the new workspace root
4. Open the agent dashboard panel pointed at the new workspace

**Confidence:** MEDIUM — structure based on Claude Code conventions (HIGH confidence) plus original design for HarnessTune-specific needs.

---

## 7. cmux Workspace Model (Reference)

cmux is an open-source macOS terminal (released February 2026 by manaflow-ai) built in Swift/AppKit with vertical tabs and a socket API. It is the closest existing reference for the HarnessTune UX model.

### Relevant Architecture Details

**Workspace = tab in sidebar.** Each tab displays:
- Git branch name
- Working directory (truncated)
- Listening ports
- Latest notification text

This is a direct model for HarnessTune's workspace tab: show agent name + status + last activity inline without expanding.

**Socket/CLI API** exposes `workspace.list`, `workspace.current`, and `workspace.move_to_window`. This suggests HarnessTune could expose a similar programmatic API (MCP tool or VSCode command) for agents to query their own workspace metadata.

**Bonsplit tab system** manages nested panes with drag-and-drop reordering — HarnessTune does not need to replicate this in the sidebar (VSCode's TreeView handles ordering), but the per-workspace split-pane concept maps to showing multiple agents within a workspace tab.

**Source:** [cmux GitHub](https://github.com/manaflow-ai/cmux) and [PROJECTS.md](https://github.com/manaflow-ai/cmux/blob/main/PROJECTS.md).

**cmux is open source and the codebase is readable.** The Swift implementation is not directly reusable in a VSCode TypeScript extension, but the UX model is a strong reference.

**Confidence:** MEDIUM — architecture inferred from changelog and documentation. Schema internals not publicly documented.

---

## 8. File Watching and Live State Updates

### VSCode Native API

Use `vscode.workspace.createFileSystemWatcher` for monitoring agent directories. The API has important scope rules:

- **String glob patterns** only watch paths inside the current VSCode workspace folder
- **`RelativePattern`** with an absolute base path watches any filesystem location, regardless of whether it's in the open workspace

For HarnessTune, agent directories may be outside the current VSCode workspace (e.g., watching `~/.claude/` or `/Users/hksul/.../agents/`). Always use `RelativePattern`:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';

function watchAgentDirectory(agentPath: string): vscode.FileSystemWatcher {
  const pattern = new vscode.RelativePattern(agentPath, '**/*');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidChange(uri => handleAgentActivity(uri));
  watcher.onDidCreate(uri => handleAgentActivity(uri));
  watcher.onDidDelete(uri => handleAgentDeletion(uri));

  return watcher;
}
```

Always push returned watchers into `context.subscriptions` to ensure disposal on extension deactivation.

### Known Gotchas

- **Recursive patterns on Windows:** `FOLDER_NAME/**` patterns have documented issues on Windows (GitHub issue #172939). Test explicitly on Windows if cross-platform support is needed.
- **Network mounts:** Watchers produce incorrect events on NFS/SMB mounts (issue #201103). If agent directories are on network storage, fall back to polling.
- **Polling fallback:** VSCode falls back to `fs.watchFile` at 5s intervals when native watching fails. Design health status UI to handle this latency gracefully — show "last seen" timestamps rather than live pulse indicators.

### Debounce Pattern

File systems generate many events for a single operation (e.g., writing a MEMORY.md produces multiple change events). Debounce before updating the health display:

```typescript
const debounceMap = new Map<string, NodeJS.Timeout>();

function handleAgentActivity(uri: vscode.Uri) {
  const agentId = resolveAgentId(uri);
  const existing = debounceMap.get(agentId);
  if (existing) clearTimeout(existing);

  debounceMap.set(agentId, setTimeout(() => {
    debounceMap.delete(agentId);
    refreshAgentHealth(agentId);
  }, 300)); // 300ms debounce
}
```

### What to Watch Per Workspace

| Path Pattern | Purpose |
|-------------|---------|
| `<workspace-root>/**/*.md` | Detect agent writes (MEMORY.md, work-log, CLAUDE.md edits) |
| `<workspace-root>/.claude/settings.json` | Detect permission changes |
| `<workspace-root>/work-log/*.md` | Detect session completions |
| `~/.claude/projects/<hash>/memory/MEMORY.md` | Global memory updates (if hash known) |

**Confidence:** HIGH for API usage — sourced from official VSCode FileSystemWatcher documentation and confirmed bug reports. MEDIUM for specific patterns — based on Claude Code filesystem conventions.

---

## 9. Recommendations Summary

### Architecture Decision: Where Each Type of Data Lives

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Workspace registry | JSON file at `globalStorageUri` | Small, no queries, human-debuggable |
| Agent metadata | JSON file at `globalStorageUri` | Same as above |
| Token/cost history | SQLite (`sql.js`) at `globalStorageUri` | Time-series, needs aggregation queries |
| Health event log | SQLite (`sql.js`) at `globalStorageUri` | Same as above |
| Active panel state | `workspaceState` + webview `setState` | VSCode managed, auto-restored |
| User preferences | `globalState` (non-synced) | Simple key-value, VSCode managed |
| API keys | `context.secrets` | Encrypted, never logged |

### Implementation Order

1. **Registry first.** Implement workspace JSON schema and CRUD before any UI. Everything else depends on it.
2. **File watcher second.** The watcher pipeline (watch → debounce → refresh health) should work before any dashboards are built.
3. **TreeView sidebar third.** The workspace switcher (TreeView with `createTreeView`) should show registered workspaces with live health badges.
4. **SQLite fourth.** Add `sql.js` for token/health history only after the basic registry works. It adds packaging complexity.
5. **Multi-panel persistence last.** Implement WebviewPanelSerializer and session-ID pattern once all panels exist.

### Critical Pitfall to Avoid

Do not store agent `rootPath` as a relative path — always absolute. VSCode opens different working directories depending on how it's launched. A relative path silently resolves to the wrong location and creates a workspace registry entry that points nowhere.

---

## Sources

- [VSCode Common Capabilities — Official API Docs](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)
- [VSCode Webview API — Official Docs](https://code.visualstudio.com/api/extension-guides/webview)
- [VSCode Tree View API — Official Docs](https://code.visualstudio.com/api/extension-guides/tree-view)
- [better-sqlite3 vs libsql vs sql.js Comparison — PkgPulse 2026](https://www.pkgpulse.com/blog/better-sqlite3-vs-libsql-vs-sql-js-sqlite-nodejs-2026)
- [VSCode Copilot Chat Agent Monitoring — Official Docs](https://github.com/microsoft/vscode-copilot-chat/blob/main/docs/monitoring/agent_monitoring.md)
- [cmux GitHub Repository](https://github.com/manaflow-ai/cmux)
- [cmux PROJECTS.md Changelog](https://github.com/manaflow-ai/cmux/blob/main/PROJECTS.md)
- [Anatomy of the .claude Folder — codewithmukesh 2026](https://codewithmukesh.com/blog/anatomy-of-the-claude-folder/)
- [Claude Agent Workspace Model — danielrosehill](https://github.com/danielrosehill/Claude-Agent-Workspace-Model/blob/main/docs/structure.md)
- [FileSystemWatcher does not detect changes in workspace dirs — GitHub Issue #177616](https://github.com/microsoft/vscode/issues/177616)
- [WebView state unexpectedly persists — GitHub Issue #240207](https://github.com/microsoft/vscode/issues/240207)
- [Using better-sqlite3 in VSCode extension — GitHub Issue #385](https://github.com/JoshuaWise/better-sqlite3/issues/385)
- [VSCode Extension Storage Options — Elio Struyf](https://www.eliostruyf.com/devhack-code-extension-storage-options/)
- [Claude Code Token Usage Tracker — Medium](https://yahya-shareef.medium.com/how-to-track-claude-token-usage-in-real-time-with-a-vs-code-extension-a596b40712c2)
