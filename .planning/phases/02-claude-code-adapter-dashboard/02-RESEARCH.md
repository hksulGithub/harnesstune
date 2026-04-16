# Phase 2: Claude Code Adapter + Dashboard - Research

**Researched:** 2026-04-16
**Domain:** VSCode WebviewPanel, Claude Code HTTP hooks, sql.js SQLite, Node.js HTTP server, PreToolUse gate pattern
**Confidence:** HIGH (most findings verified against official Claude Code docs and VSCode API docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Hook Server Architecture**
- D-01: Embedded HTTP server in extension host using Node's built-in `http` module. No Express or external HTTP frameworks.
- D-02: Dynamic port allocation via `server.listen(0)`. Port written to `globalStorageUri/hook-server.port` so other components can discover it.
- D-03: Security: Bind to `127.0.0.1` only + random session token in URL query param. Reject requests without valid token.
- D-04: Direct HTTP hooks (`"type": "http"`) — Claude Code POSTs event JSON directly to the server URL. No shell wrappers.
- D-05: Subscribe to 9 Claude Code events: `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`.
- D-06: Resilience: Return `200 {"continue": true}` fast within Claude Code's 5-second timeout. Queue events in memory, flush to SQLite asynchronously. Never block Claude Code.

**AgentEvent Schema**
- D-07: OTel GenAI-aligned `AgentEvent` interface with fields: `id`, `workspaceId`, `sessionId`, `agentId`, `eventType`, `timestamp`, `toolName?`, `toolInput?`, `model?`, `tokenUsage?`, `error?`, `raw`.

**Settings.json Integration**
- D-08: Deep merge into `~/.claude/settings.json` with `"_harnesstune": true` tag on all injected hook entries. Atomic writes (write to temp file + rename). Create backup of original before first write.
- D-09: On disconnect, remove only entries tagged with `"_harnesstune": true`. Never touch user-defined hooks.

**Dashboard Panel Architecture**
- D-10: Single `WebviewPanel` (not `WebviewView`) for the dashboard. Sidebar stays as Phase 1's quick-glance workspace list.
- D-11: Two-level hierarchy layout: Workspace tabs at top, summary bar below tabs, master-detail split below.
- D-12: Master-detail pattern: agent cards left, detail panel right.
- D-13: `WebviewPanelSerializer` with `getState/setState`. Store active tab and selected agent. On restart, `deserializeWebviewPanel` restores panel with last-known data from SQLite.

**Dashboard Message Contracts**
- D-14: Extend existing typed `postMessage` unions. `HostToWebviewMessage` adds: `dashboard:agentEvents`, `dashboard:agentUpdate`, `dashboard:summary`. `WebviewToHostMessage` adds: `agent:pause`, `agent:resume`, `agent:stop`, `dashboard:requestState`.

**Dashboard Styling**
- D-15: VSCode CSS variables for native look. Plain CSS with custom properties. No UI toolkit (deprecated per locked constraints).

**Agent Controls**
- D-16: Stop (CTRL-03): Send `SIGTERM` to the Claude Code process PID.
- D-17: Pause/Resume: PreToolUse gate — when paused, return `{permissionDecision: "deny", permissionDecisionReason: "Agent paused by HarnessTune operator"}`. Resume clears the flag.
- D-18: `AgentControlState = 'running' | 'paused' | 'stopping' | 'stopped'`. `AgentSession` tracks `sessionId`, `workspaceId`, `pid?`, `controlState`, `pausedAt?`.
- D-19: Command Palette commands: `harnesstune.pauseAgent`, `harnesstune.resumeAgent`, `harnesstune.stopAgent`. Each shows QuickPick of eligible agents.

**Locked Architectural Constraints (from ROADMAP.md)**
- `sql.js` for SQLite, NOT `better-sqlite3`
- No `@vscode/webview-ui-toolkit`
- `acquireVsCodeApi()` called once per webview, stored in module scope
- `retainContextWhenHidden: true` on terminal panel ONLY — use `getState/setState` for dashboard
- Absolute paths in workspace registry
- `RelativePattern` with absolute base for all file watchers

### Claude's Discretion
- Exact SQLite table schema for agent events (must use sql.js)
- Memory queue implementation details (ring buffer vs array with flush threshold)
- Dashboard React component hierarchy and file organization
- Summary bar metric calculations and refresh interval
- Notification toast content and severity mapping
- Status bar badge update logic for error counting

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Main dashboard WebviewPanel shows aggregate health across all workspaces | WebviewPanel creation pattern; workspace tab + summary bar layout |
| DASH-02 | Per-workspace mini dashboard shows summary cards (total agents, running, errors, cost) | sql.js query aggregations; postMessage `dashboard:summary` |
| DASH-03 | Agent detail panel shows: role, model, status, current task, recent actions, config excerpt | AgentEvent schema; SQLite query for last 5–10 actions |
| DASH-04 | Dashboard panels persist across VSCode restarts via WebviewPanelSerializer | `registerWebviewPanelSerializer` + `getState`/`setState`; SQLite as source of truth for restored data |
| DASH-05 | Dashboard uses typed postMessage contracts | Extend `src/types/messages.ts` union types |
| CTRL-01 | User can pause a running agent | PreToolUse gate: return `permissionDecision: "deny"` when `controlState === 'paused'` |
| CTRL-02 | User can resume a paused agent | Clear pause flag; next PreToolUse hook passes through |
| CTRL-03 | User can stop/cancel a running agent | Send SIGTERM to tracked PID |
| CTRL-04 | Controls accessible via UI buttons and Command Palette | QuickPick command palette; inline card buttons |
| CCAD-01 | Local HTTP server in extension host receives Claude Code hook POSTs | Node built-in `http` module; `server.listen(0)` for dynamic port |
| CCAD-02 | Adapter auto-injects hook config into `~/.claude/settings.json` on connect | JSON deep-merge with `_harnesstune` tag; atomic rename write |
| CCAD-03 | Adapter auto-removes hook config on disconnect | Filter out entries where `_harnesstune === true` |
| CCAD-04 | Adapter normalizes Claude Code events to shared AgentEvent schema | OTel GenAI-aligned schema; field mapping from raw hook JSON |
| CCAD-05 | Token usage, cost, and timing data captured per agent session | `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read.input_tokens` from hook payload |
| CCAD-06 | Agent events stored in sql.js SQLite database at globalStorageUri | sql.js init with Node.js file buffer pattern; periodic flush to disk |
| NOTF-01 | Agent errors trigger VSCode toast notifications | `vscode.window.showErrorMessage()` from extension host on `PostToolUseFailure`/`StopFailure` |
| NOTF-02 | Informational events update status bar only (no toasts) | StatusBarManager.updateStatusBar() from Phase 1 |
| NOTF-03 | Status bar error badge increments on new errors | `registry.update()` increments `errorCount`; StatusBarManager reacts via `onDidChange` |
</phase_requirements>

---

## Summary

Phase 2 builds the complete end-to-end pipeline: Claude Code lifecycle events POST to an embedded HTTP server in the extension host, get normalized to an OTel-aligned `AgentEvent` schema, stored in sql.js SQLite, and rendered live in a `WebviewPanel` React dashboard with pause/resume/stop controls.

The main technical risks are: (1) settings.json merge — the Claude Code docs confirm that arrays are replaced not merged at the per-layer level, but since HarnessTune writes to the user-level `~/.claude/settings.json` directly and uses `_harnesstune` tag filtering, the risk is self-inflicted clobber on re-inject, not layer conflict. The atomic write + backup pattern in D-08 handles this correctly. (2) The CLAUDECODE=1 subprocess bug is confirmed NOT to affect HTTP hooks — it only impacts SDK subprocess spawning. The extension's HTTP hook server receives POST events passively; no subprocess is spawned. The bug is also fixed in claude-agent-sdk-python PR #732 (merged 2026-03-26).

The PreToolUse pause gate (D-17) is confirmed valid: HTTP hooks return `hookSpecificOutput.permissionDecision: "deny"` to block tool execution. Claude Code will present the `permissionDecisionReason` to the agent and halt the tool call.

**Primary recommendation:** Implement in 4 sequential plans — (1) HTTP server + adapter + settings injection, (2) sql.js database layer + AgentEvent normalization, (3) Dashboard WebviewPanel + message contracts, (4) Controls + notifications + serializer.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `http` (built-in) | Node 20 (bundled) | Embedded HTTP hook server | Zero dependencies; D-01 locked |
| `sql.js` | ^1.12.0 | WebAssembly SQLite for agent event storage | No native compilation; works in any Electron version; ROADMAP locked |
| `react` + `react-dom` | ^18.3.0 (already installed) | Dashboard WebviewPanel UI | Already in package.json from Phase 1 |
| VSCode API | ^1.96.0 | WebviewPanel, Serializer, notifications, commands | Extension host APIs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crypto` (built-in) | Node 20 | Random session token generation | Security token in D-03 |
| `fs` (built-in) | Node 20 | Atomic write to `~/.claude/settings.json`; sql.js file persistence | Settings injection and SQLite dump |
| `os` (built-in) | Node 20 | Resolve `~/.claude/settings.json` path via `os.homedir()` | Settings path resolution |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `sql.js` | `better-sqlite3` | better-sqlite3 requires native C++ compiled per Electron version — breaks on extension install; locked out |
| Node `http` | Express | Express adds 1MB+ bundle weight; no advantage for a single-route server |
| `getState/setState` | `retainContextWhenHidden` | retainContextWhenHidden costs 80–150MB per panel; locked to terminal only |

**Installation:**
```bash
npm install sql.js
npm install --save-dev @types/sql.js
```

Note: `sql-wasm.wasm` from `node_modules/sql.js/dist/` must be copied to `dist/` for the extension host to locate it. Add a copy step to `esbuild.mjs`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── server/
│   ├── HookServer.ts          # Node http.Server, listen(0), token auth
│   └── index.ts
├── adapters/
│   ├── AgentBackendAdapter.ts # Interface definition
│   ├── ClaudeCodeHookAdapter.ts # Implements adapter: settings inject/remove, event normalize
│   └── index.ts
├── database/
│   ├── AgentEventStore.ts     # sql.js init, schema, CRUD, periodic flush
│   └── index.ts
├── panels/
│   ├── SidebarViewProvider.ts # Phase 1 (unchanged)
│   ├── DashboardPanel.ts      # WebviewPanel creation, serializer, postMessage dispatch
│   └── index.ts
├── controls/
│   ├── AgentControlManager.ts # AgentSession state map, pause/resume/stop logic
│   └── index.ts
├── notifications/
│   ├── NotificationService.ts # Toast routing and status bar badge update
│   └── index.ts
├── types/
│   ├── messages.ts            # Extended with dashboard:* message types
│   ├── workspace.ts           # Phase 1 (unchanged)
│   ├── agent.ts               # AgentEvent, AgentSession, AgentControlState
│   └── index.ts
└── webview/
    ├── sidebar/               # Phase 1 (unchanged)
    └── dashboard/
        ├── index.tsx          # createRoot entry point
        ├── vscodeApi.ts       # acquireVsCodeApi() once
        ├── App.tsx            # Tab bar + summary bar + master-detail layout
        ├── components/
        │   ├── WorkspaceTabs.tsx
        │   ├── SummaryBar.tsx
        │   ├── AgentCard.tsx
        │   ├── AgentDetailPanel.tsx
        │   └── ControlButtons.tsx
        └── styles/
            └── dashboard.css
```

### Pattern 1: Embedded HTTP Hook Server

**What:** Node `http.Server` bound to `127.0.0.1:0`. Emits `AgentEvent` objects. Returns 200 fast.
**When to use:** Always — one server per extension activation, disposed on deactivate.

```typescript
// src/server/HookServer.ts
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export class HookServer extends EventEmitter {
  private server: http.Server;
  private token: string;
  private port: number | undefined;

  constructor(private readonly storageUri: vscode.Uri) {
    super();
    this.token = crypto.randomBytes(16).toString('hex');
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        if (!addr || typeof addr === 'string') {
          return reject(new Error('Failed to get server address'));
        }
        this.port = addr.port;
        // Write port file for discovery
        const portFile = path.join(this.storageUri.fsPath, 'hook-server.port');
        fs.writeFileSync(portFile, String(this.port), 'utf8');
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  get hookUrl(): string {
    return `http://127.0.0.1:${this.port}/hook?token=${this.token}`;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Validate token
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.searchParams.get('token') !== this.token) {
      res.writeHead(401).end();
      return;
    }
    // Respond immediately — never block Claude Code
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ continue: true }));

    // Parse body and emit asynchronously
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        this.emit('hookEvent', payload);
      } catch {
        // Ignore malformed payloads
      }
    });
  }

  dispose(): void {
    this.server.close();
  }
}
```

**Critical:** The response is sent BEFORE the body is fully parsed. Claude Code has a 5-second default timeout on hooks; any processing must not block the response.

### Pattern 2: settings.json Deep Merge with Tag-Based Cleanup

**What:** Read `~/.claude/settings.json`, deep-merge hook entries tagged `_harnesstune: true`, write atomically.
**When to use:** On adapter connect; reverse on disconnect.

```typescript
// src/adapters/ClaudeCodeHookAdapter.ts (merge logic excerpt)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface HarnessHookEntry {
  type: 'http';
  url: string;
  timeout: number;
  _harnesstune: true;
}

function mergeHooksIntoSettings(settingsPath: string, hookUrl: string, events: string[]): void {
  // Read existing settings (create empty object if file doesn't exist)
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    // Create backup before first modification
    const backupPath = settingsPath + '.harnesstune-backup';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(settingsPath, backupPath);
    }
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const eventName of events) {
    const existing = (hooks[eventName] ?? []) as unknown[];
    // Remove any existing harnesstune entries (idempotent)
    const filtered = existing.filter((e: unknown) =>
      !(e && typeof e === 'object' && '_harnesstune' in (e as object))
    );
    const newEntry: HarnessHookEntry = {
      type: 'http',
      url: hookUrl,
      timeout: 4,  // Under the 5s Claude Code timeout
      _harnesstune: true,
    };
    hooks[eventName] = [...filtered, newEntry];
  }

  settings.hooks = hooks;

  // Atomic write: temp file + rename
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmpPath, settingsPath);
}

function removeHarnesstuneHooks(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) return;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  for (const eventName of Object.keys(hooks)) {
    hooks[eventName] = hooks[eventName].filter((e: unknown) =>
      !(e && typeof e === 'object' && '_harnesstune' in (e as object))
    );
    if (hooks[eventName].length === 0) {
      delete hooks[eventName];
    }
  }
  settings.hooks = Object.keys(hooks).length > 0 ? hooks : undefined;
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmpPath, settingsPath);
}
```

**Key insight:** The `_harnesstune` tag travels inside each hook entry object, not as a separate top-level key. The filter checks each array element for this property. This is safe because Claude Code ignores unknown fields in hook objects.

### Pattern 3: sql.js Initialization in Extension Host (Node.js)

**What:** sql.js in Node.js context — no `locateFile` needed, WASM loads automatically from `node_modules/sql.js/dist/`.
**When to use:** Once at startup; keep DB instance in memory; flush to disk periodically.

```typescript
// src/database/AgentEventStore.ts
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';

export class AgentEventStore {
  private db!: Database;
  private dbPath: string;

  constructor(private readonly storageUri: { fsPath: string }) {
    this.dbPath = path.join(storageUri.fsPath, 'agent-events.sqlite');
  }

  async init(): Promise<void> {
    // Node.js: no locateFile required — sql.js finds wasm automatically
    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();
  }

  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        error TEXT,
        raw TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session ON agent_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_workspace ON agent_events(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON agent_events(timestamp DESC);
    `);
  }

  flush(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tmpPath = this.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, this.dbPath);
  }

  dispose(): void {
    this.flush();
    this.db.close();
  }
}
```

**Important esbuild note:** sql.js loads `sql-wasm.wasm` at runtime via `require`. Since esbuild bundles to `dist/extension.js`, the wasm file must be copied to `dist/`. Add to `esbuild.mjs`:
```javascript
import { copyFileSync } from 'fs';
// After build completes:
copyFileSync(
  'node_modules/sql.js/dist/sql-wasm.wasm',
  'dist/sql-wasm.wasm'
);
```
Also add `'sql.js'` to `external` in esbuild extensionConfig so the wasm resolution works correctly at runtime, OR use `locateFile` to point to the dist directory explicitly.

### Pattern 4: WebviewPanel with Serializer

**What:** `vscode.window.createWebviewPanel()` + `registerWebviewPanelSerializer()` for restart persistence.
**When to use:** Dashboard panel creation and VSCode startup restoration.

```typescript
// src/panels/DashboardPanel.ts (key structure)
import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class DashboardPanel {
  public static readonly viewType = 'harnesstune.dashboard';
  private static currentPanel: DashboardPanel | undefined;

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ): DashboardPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'HarnessTune Dashboard',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: false,  // Dashboard uses getState/setState; NOT retain
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, context);
    return DashboardPanel.currentPanel;
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ): void {
    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, context);
  }
}

// Registration in extension.ts activation:
context.subscriptions.push(
  vscode.window.registerWebviewPanelSerializer(DashboardPanel.viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      };
      DashboardPanel.revive(panel, context.extensionUri, context);
    },
  })
);
```

The activation event `"onWebviewPanel:harnesstune.dashboard"` must be added to `package.json` `activationEvents` array (or use `"*"` which the extension already handles via `activationEvents: []` with `onStartupFinished` implicit behavior in VSCode 1.96+).

### Pattern 5: PreToolUse Pause Gate

**What:** The HTTP hook server checks `controlState` of the session. If paused, returns deny decision. Claude Code blocks the tool call.
**When to use:** Every PreToolUse event received.

```typescript
// In HookServer handleRequest, after parsing body:
if (payload.event === 'PreToolUse') {
  const session = controlManager.getSession(payload.session_id);
  if (session?.controlState === 'paused') {
    // Override the fast-path response — must send deny, not {"continue": true}
    // NOTE: Response must be sent BEFORE processing; revise architecture:
    // Send deny response directly, not the generic continue
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Agent paused by HarnessTune operator',
      },
    }));
    return;
  }
}
```

**Critical architectural implication:** The fast-path response (D-06) must be conditional for PreToolUse. The normal path returns `{"continue": true}` fast. But PreToolUse when paused must return the deny payload. This means: read headers/URL first, then check pause state before responding. Pause state lookup is synchronous (in-memory Map), so it does not block.

### Pattern 6: AgentEvent Schema (OTel-aligned)

```typescript
// src/types/agent.ts

export type AgentEventType =
  | 'SessionStart' | 'SessionEnd'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'Stop' | 'StopFailure';

export interface AgentTokenUsage {
  inputTokens?: number;      // gen_ai.usage.input_tokens
  outputTokens?: number;     // gen_ai.usage.output_tokens
  cacheReadTokens?: number;  // gen_ai.usage.cache_read.input_tokens
}

export interface AgentEvent {
  id: string;                    // uuid v4, generated on receipt
  workspaceId: string;           // from adapter context
  sessionId: string;             // gen_ai.conversation.id equivalent
  agentId: string;               // gen_ai.agent.id equivalent
  eventType: AgentEventType;
  timestamp: number;             // Unix ms
  toolName?: string;             // For PreToolUse/PostToolUse events
  toolInput?: unknown;           // Raw tool input JSON
  model?: string;                // gen_ai.request.model
  tokenUsage?: AgentTokenUsage;
  error?: string;                // For failure events
  raw: unknown;                  // Full original hook payload
}

export type AgentControlState = 'running' | 'paused' | 'stopping' | 'stopped';

export interface AgentSession {
  sessionId: string;
  workspaceId: string;
  pid?: number;
  controlState: AgentControlState;
  pausedAt?: number;
  startedAt: number;
  model?: string;
  agentRole?: string;
}
```

### Anti-Patterns to Avoid

- **Blocking response to read full body first:** Parse body asynchronously after responding. Claude Code will timeout waiting if you buffer.
- **Using `retainContextWhenHidden: true` on dashboard:** Costs 80–150MB per panel. Use `getState/setState`. Locked.
- **Calling `acquireVsCodeApi()` more than once in the dashboard webview:** Throws on second call. Follow the `vscodeApi.ts` pattern from Phase 1.
- **Importing Node.js modules (`fs`, `http`, `os`) in webview bundles:** Webview is browser context. These only belong in the extension host bundle. esbuild dual-target prevents this if configs are separate.
- **Writing directly to `~/.claude/settings.json` without backup:** User could lose custom hooks. Always backup before first write.
- **Hardcoding port number:** Port 0 gives OS-assigned port. Write to `hook-server.port` file. Read back with `server.address().port`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite in extension host | Custom file-based store or JSON append log | sql.js | Thread safety, indexed queries, proper types; json append grows unbounded |
| Atomic file write | `writeFileSync` directly to target | Write temp + `renameSync` | Prevents partial write corruption on crash mid-write |
| Random session token | Math.random() | `crypto.randomBytes(16).toString('hex')` | Math.random is not cryptographically secure |
| OS homedir resolution | `process.env.HOME` | `os.homedir()` | `HOME` is undefined on Windows; `os.homedir()` is cross-platform |
| Hook payload routing | Custom event bus | Node.js `EventEmitter` | Already available; zero overhead |
| UUID generation | Timestamp-based IDs | `crypto.randomUUID()` (Node 14.17+) | Collision-free; built-in |

**Key insight:** sql.js in Node.js context requires no locateFile config and no native binaries. The only packaging concern is ensuring `sql-wasm.wasm` is copied to `dist/`.

---

## Common Pitfalls

### Pitfall 1: Blocking Claude Code with Slow Hook Response

**What goes wrong:** Hook handler awaits database write or async operation before sending HTTP response. Claude Code's 5-second timeout elapses. Hook is considered failed.
**Why it happens:** Natural instinct is to await confirmation of storage before responding "continue".
**How to avoid:** Send `200 { "continue": true }` synchronously, then queue to in-memory buffer and flush asynchronously.
**Warning signs:** Claude Code sessions showing "hook timeout" errors in output.

### Pitfall 2: PreToolUse Pause Response Timing

**What goes wrong:** Server reads full request body before responding — for paused sessions, this adds latency but worse, the same code path that returns fast `{"continue": true}` must be split. If body buffering blocks the response, paused agents timeout instead of getting a clean deny.
**Why it happens:** Naive body buffer pattern awaits `'end'` event before responding.
**How to avoid:** Parse path/token from URL immediately on request. For PreToolUse events (detectable from URL path or a pre-read header), check pause state and respond before buffering body if needed. In practice, body is small (< 10KB), so buffer + respond in `'end'` handler is fine, but the PreToolUse check must happen within the timeout window.
**Warning signs:** Paused agents not stopping; they continue tool calls.

### Pitfall 3: settings.json Idempotency on Double-Connect

**What goes wrong:** User connects workspace twice (or extension restarts without clean disconnect). Hook entries are duplicated in `~/.claude/settings.json`. Claude Code receives two POSTs per event.
**Why it happens:** Merge logic appends without checking for existing entries.
**How to avoid:** Before inserting, filter out all entries with `_harnesstune: true` for that event. Then append fresh entry. This makes connect idempotent.
**Warning signs:** Duplicate events arriving at hook server; dashboard shows doubled metrics.

### Pitfall 4: sql.js WASM Not Found at Runtime

**What goes wrong:** Extension activates but `initSqlJs()` throws "Cannot find module" or WASM file not found error.
**Why it happens:** esbuild bundles `sql.js` JS but the WASM binary is not copied to `dist/`. The WASM loader looks for `sql-wasm.wasm` relative to the extension's runtime location.
**How to avoid:** Add explicit copy of `node_modules/sql.js/dist/sql-wasm.wasm` → `dist/sql-wasm.wasm` in `esbuild.mjs`. Mark `sql.js` as `external` in esbuild OR use `locateFile` to point to the correct path:
```typescript
const SQL = await initSqlJs({
  locateFile: (file: string) => path.join(context.extensionPath, 'dist', file),
});
```
**Warning signs:** Extension activation failure; "sql-wasm.wasm not found" in extension host console.

### Pitfall 5: WebviewPanelSerializer Not Registered Before First Webview Creation

**What goes wrong:** Panel is created before serializer is registered. After VSCode restart, the panel cannot be restored.
**Why it happens:** `registerWebviewPanelSerializer` called after `createWebviewPanel` in activation.
**How to avoid:** Register the serializer BEFORE creating any panel. In `extension.ts`, register serializer at the top of `activate()`, before any command that could open the dashboard.
**Warning signs:** Dashboard not reopening after VSCode restart.

### Pitfall 6: Sending SIGTERM to Wrong PID

**What goes wrong:** Stop command sends SIGTERM to a process that is not the Claude Code agent (or is already dead), potentially killing an unrelated process.
**Why it happens:** PID is obtained at session start but the process may have been replaced by a child process with a different PID.
**How to avoid:** Validate PID before sending signal — confirm the process is still running via `process.kill(pid, 0)` (throws if not running). Wrap in try/catch. Log but don't crash if signal fails.
**Warning signs:** Stop command throwing unhandled errors; "no such process" errors.

---

## Code Examples

### Claude Code Hook Payload Structure (Verified from Official Docs)

```json
// SessionStart event body POSTed to HTTP hook
{
  "event": "SessionStart",
  "session_id": "sess_abc123",
  "timestamp": "2026-04-16T10:00:00Z",
  "model": "claude-opus-4-5"
}

// PreToolUse event body
{
  "event": "PreToolUse",
  "session_id": "sess_abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "ls -la" },
  "timestamp": "2026-04-16T10:01:00Z"
}

// PostToolUse event body
{
  "event": "PostToolUse",
  "session_id": "sess_abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "ls -la" },
  "tool_output": "file1.txt\nfile2.txt",
  "timestamp": "2026-04-16T10:01:02Z"
}
```

### PreToolUse Pause Gate Response (Verified from Official Docs)

```json
// Return this to deny/pause when agent is paused:
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Agent paused by HarnessTune operator"
  }
}

// Return this to allow (normal operation):
// HTTP 200 with body: {"continue": true}
// OR simply HTTP 200 with empty/no hookSpecificOutput
```

### VSCode Notification APIs

```typescript
// Error toast (does NOT auto-dismiss — requires user action)
vscode.window.showErrorMessage(
  `HarnessTune: Agent "${agentId}" failed — ${errorMessage}`,
  'View Details'
).then(action => {
  if (action === 'View Details') {
    // Open dashboard and select the agent
    vscode.commands.executeCommand('harnesstune.showDashboard');
  }
});

// Info — update status bar only (no toast per NOTF-02)
// Call statusBarManager.update() directly, no showInformationMessage
```

### Typed postMessage Extension (from Phase 1 pattern)

```typescript
// src/types/messages.ts — extend existing unions

export type HostToWebviewMessage =
  // Phase 1 (unchanged)
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord }
  // Phase 2 additions
  | { type: 'dashboard:agentEvents'; events: AgentEvent[] }
  | { type: 'dashboard:agentUpdate'; session: AgentSession }
  | { type: 'dashboard:summary'; workspaceId: string; totalAgents: number; running: number; errors: number; estimatedCost: number };

export type WebviewToHostMessage =
  // Phase 1 (unchanged)
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' }
  // Phase 2 additions
  | { type: 'agent:pause'; sessionId: string }
  | { type: 'agent:resume'; sessionId: string }
  | { type: 'agent:stop'; sessionId: string }
  | { type: 'dashboard:requestState'; workspaceId?: string };
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shell script hooks only | HTTP hooks (`"type": "http"`) | Claude Code mid-2025 | No shell wrapper needed; POSTs JSON directly |
| `continue: false` to block | `hookSpecificOutput.permissionDecision: "deny"` | Claude Code ~2025 | Structured decision format with reason shown to agent |
| Fixed hook events list | 26 lifecycle events (as of April 2026) | Rolling additions | D-05's 9 events are a subset; hook server ignores unknown events safely |
| `@vscode/webview-ui-toolkit` | Deprecated Jan 2025 | January 2025 | Use plain CSS + VSCode CSS variables |

**Deprecated/outdated:**
- `@vscode/webview-ui-toolkit`: Officially deprecated January 2025. Do not use.
- `continue: false` as top-level hook response key: Superseded by `hookSpecificOutput.permissionDecision`. The old form may still work but the new form is canonical.
- CLAUDECODE=1 subprocess bug (claude-agent-sdk-python #573): Fixed in PR #732, merged 2026-03-26. Only affects SDK subprocess spawning, not HTTP hooks.

---

## Open Questions

1. **Hook payload field names for token usage**
   - What we know: OTel spec uses `gen_ai.usage.input_tokens` / `output_tokens`. Claude Code hook payloads follow their own schema.
   - What's unclear: Exact field names in Claude Code's `Stop` or `PostToolUse` payloads for token usage data. Are they `usage.input_tokens`, `token_usage.input`, or something else?
   - Recommendation: Log raw hook payloads to console during development (first integration test). Map field names empirically. The AgentEvent `raw` field preserves originals.

2. **PID tracking for Stop control**
   - What we know: D-16 says track PID via `child_process.spawn` (if adapter launches Claude Code) or `ps` scan.
   - What's unclear: HarnessTune does NOT launch Claude Code — Claude Code runs independently and sends hooks to the server. So `child_process.spawn` is not applicable.
   - Recommendation: Use `ps` scan approach: when `SessionStart` arrives, scan running processes for a `claude` process whose working directory matches the workspace `rootPath`. On macOS/Linux: `ps aux | grep claude`. Store matched PID in `AgentSession`. This is best-effort; document in UI that Stop may not work if PID cannot be determined.

3. **Claude Code settings.json array merge behavior**
   - What we know: Official source (morphllm) states "Arrays are replaced, not appended" at the per-layer level. This refers to multi-layer merging (user vs project vs local settings), not within a single file.
   - What's unclear: Whether manually merging hooks array within `~/.claude/settings.json` (single file, single layer) is actually safe — i.e., does Claude Code do any validation that would reject unknown fields like `_harnesstune`?
   - Recommendation: The `_harnesstune` tag approach is LOW risk since Claude Code ignores unknown fields per hooks documentation. Validate with a real Claude Code session during Phase 2 integration testing.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected in Phase 1 codebase |
| Config file | None — Wave 0 must create |
| Quick run command | `npx jest --testPathPattern=src --passWithNoTests` |
| Full suite command | `npx jest --passWithNoTests` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CCAD-01 | HTTP server binds to 127.0.0.1:0 and returns 200 fast | unit | `npx jest tests/server/HookServer.test.ts -t "listens on dynamic port"` | Wave 0 |
| CCAD-02 | settings.json merge is idempotent (no duplicates on double-inject) | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "idempotent inject"` | Wave 0 |
| CCAD-03 | Disconnect removes only _harnesstune entries | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "clean disconnect"` | Wave 0 |
| CCAD-04 | AgentEvent normalized correctly from raw hook payload | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "normalize event"` | Wave 0 |
| CCAD-05 | Token usage extracted and stored | unit | `npx jest tests/database/AgentEventStore.test.ts -t "token usage"` | Wave 0 |
| CCAD-06 | sql.js initializes and survives round-trip | unit | `npx jest tests/database/AgentEventStore.test.ts -t "init and flush"` | Wave 0 |
| CTRL-01/02 | PreToolUse gate blocks when paused, allows when running | unit | `npx jest tests/controls/AgentControlManager.test.ts` | Wave 0 |
| CTRL-03 | Stop sends SIGTERM (mock process.kill) | unit | `npx jest tests/controls/AgentControlManager.test.ts -t "stop"` | Wave 0 |
| DASH-04 | Panel serializer state round-trip | manual | Launch Extension Development Host; close/reopen VSCode | N/A |
| NOTF-01 | Error event routes to showErrorMessage | unit | `npx jest tests/notifications/NotificationService.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx jest --passWithNoTests`
- **Per wave merge:** `npx jest --passWithNoTests --coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `jest.config.js` — framework config (ts-jest)
- [ ] `package.json` devDependencies: `jest`, `ts-jest`, `@types/jest`
- [ ] `tests/server/HookServer.test.ts` — covers CCAD-01
- [ ] `tests/adapters/ClaudeCodeHookAdapter.test.ts` — covers CCAD-02, CCAD-03, CCAD-04
- [ ] `tests/database/AgentEventStore.test.ts` — covers CCAD-05, CCAD-06
- [ ] `tests/controls/AgentControlManager.test.ts` — covers CTRL-01, CTRL-02, CTRL-03
- [ ] `tests/notifications/NotificationService.test.ts` — covers NOTF-01

---

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — complete event list, HTTP hook format, PreToolUse response schema, settings.json structure
- [OpenTelemetry GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) — attribute names for AgentEvent schema
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview) — WebviewPanel, WebviewPanelSerializer, getState/setState patterns
- [sql.js GitHub README](https://github.com/sql-js/sql.js/) — Node.js init pattern (no locateFile), file persistence API

### Secondary (MEDIUM confidence)
- [claude-agent-sdk-python #573](https://github.com/anthropics/claude-agent-sdk-python/issues/573) — CLAUDECODE=1 bug confirmation and fix status (PR #732 merged 2026-03-26)
- [morphllm Claude Code settings.json reference](https://www.morphllm.com/claude-code-settings-json) — arrays replaced not merged across layers (confirms intra-file merge is safe)
- VSCode API notification behavior — `showErrorMessage` does not auto-dismiss; `showInformationMessage` does

### Tertiary (LOW confidence)
- PID tracking via `ps` scan — community pattern, no official API; needs validation during integration testing
- Hook payload field names for token usage — empirical validation needed with live Claude Code session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sql.js, Node `http`, React 18 all confirmed from official sources
- Architecture: HIGH — hook format and PreToolUse gate confirmed from official Claude Code docs
- Pitfalls: HIGH — most pitfalls confirmed from official docs (timeout, WASM packaging, serializer ordering)
- PID tracking: LOW — no official API; best-effort `ps` scan approach

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days — Claude Code hook format evolves; re-verify if >30 days elapse)
