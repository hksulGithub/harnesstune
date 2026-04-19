# Architecture: v2.0 Remote Agent Management Integration

**Project:** HarnessTune
**Scope:** How three new packages integrate with v1.0 extension architecture
**Researched:** 2026-04-19

---

## Summary

v2.0 adds a relay/mailbox layer that sits between remote agent machines and the local extension. Three new deployable units are introduced: `harnesstune-relay` (Vercel serverless + Turso), `harnesstune-agent` (CLI sidecar on remote machines), and an updated extension with `RemoteAdapter`. The integration strategy is additive — v1.0 local behavior is unchanged. Remote workspaces are surfaced through the existing `WorkspaceRegistry` and `AgentBackendAdapter` interface, which means the sidebar, dashboard, and message contracts require targeted extensions but not rewrites.

The critical architectural insight is that `RemoteAdapter` is not a true real-time adapter like `ClaudeCodeHookAdapter`. It polls the relay on a timer instead of reacting to events. This polling model threads through how remote workspaces show status, how reports surface in the UI, and why a separate `ReportPanel` is needed rather than reusing `DashboardPanel`. Everything else — SecretStore, WorkspaceRegistry, postMessage contracts, AdapterRegistry — stays structurally intact with additive changes only.

---

## New Components

### harnesstune-relay (new package, Vercel serverless)

A stateless REST API deployed as Vercel serverless functions. It is the central mailbox — agents push data up, the extension pulls data down. All business logic lives in the clients; the relay is a dumb document store.

**Endpoints (generic channel API):**

```
POST   /api/channels                        Create channel (agent registration)
GET    /api/channels/:channelId             Get channel metadata
POST   /api/channels/:channelId/reports     Upload report document
GET    /api/channels/:channelId/reports     List reports (with pagination)
GET    /api/channels/:channelId/reports/:id Fetch single report
POST   /api/channels/:channelId/messages    Post message (extension → agent)
GET    /api/channels/:channelId/messages    Poll messages (agent → extension)
DELETE /api/channels/:channelId/messages/:id Acknowledge/delete message
```

All endpoints require `Authorization: Bearer <token>` header. Token is scoped to a single channel. The relay validates token against the `tokens` table and enforces channel-level isolation.

**Turso database schema:**

```sql
-- One row per remote agent workspace
CREATE TABLE channels (
  id          TEXT PRIMARY KEY,           -- UUID, "channel ID" = workspace ID on relay
  name        TEXT NOT NULL,              -- display name set at registration
  created_at  INTEGER NOT NULL,           -- Unix ms
  last_seen   INTEGER                     -- updated on any agent activity
);

-- Per-channel API tokens (one token per agent for now; extensible to multi-token)
CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,           -- UUID
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,       -- SHA-256 hex of bearer token (never store plaintext)
  created_at  INTEGER NOT NULL,
  label       TEXT                        -- optional human label ("prod-mac-1")
);

-- Structured report documents (daily briefings, ralph loop iterations)
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,           -- UUID
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,              -- "daily_briefing" | "ralph_loop"
  payload     TEXT NOT NULL,             -- JSON blob (typed by report_type)
  created_at  INTEGER NOT NULL,
  agent_ts    INTEGER                    -- timestamp from agent's local clock
);
CREATE INDEX idx_reports_channel ON reports(channel_id, created_at DESC);

-- Async messages: extension → agent (instructions, feedback)
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  body        TEXT NOT NULL,             -- plain text or JSON
  created_at  INTEGER NOT NULL,
  read_at     INTEGER,                   -- set when agent acknowledges
  read        INTEGER NOT NULL DEFAULT 0 -- 0|1 for SQLite boolean
);
CREATE INDEX idx_messages_channel ON messages(channel_id, direction, read, created_at DESC);
```

**Notes on schema design:**
- `token_hash` only — relay never stores raw tokens. Raw token shown once at registration, then discarded.
- `reports.payload` is a JSON string typed by `report_type`. Client-side deserializes into typed structs. Relay is schema-agnostic.
- `messages.direction` distinguishes extension-to-agent (outbound from relay's view) from agent-to-extension replies. For v2 the extension only writes, the agent only reads and optionally replies. Both directions share the table.

---

### harnesstune-agent (new npm package, CLI sidecar)

A Node.js CLI that runs on each remote machine alongside the agent system. No VSCode, no open ports required.

**Entry point:** `npx harnesstune-agent --relay <url> --token <token> --adapter <type> --workspace <path>`

**Internal architecture:**

```
harnesstune-agent
  ├── RegistrationClient      Calls POST /api/channels on first run; persists channel ID + token to ~/.harnesstune-agent/<id>.json
  ├── LocalAdapterDelegate    Thin wrapper that tail-reads JSONL / hooks — same logic as extension adapters, no reuse of extension code
  ├── ReportScheduler         Timer-driven; collects state from LocalAdapterDelegate; serializes to report JSON; calls POST /api/channels/:id/reports
  ├── MessagePoller           Polls GET /api/channels/:id/messages on interval (e.g., 60s); hands inbound messages to InstructionRouter
  └── InstructionRouter       Parses message body; routes to local agent (e.g., writes to stdin, sends SIGCONT, appends to task queue file)
```

**State files on remote machine:**

```
~/.harnesstune-agent/
  <channel-id>.json    { channelId, relayUrl, tokenPlaintext, adapterType, workspacePath }
```

Token is stored plaintext on the agent machine (it is a secret credential the user controls). SecretStore is a VSCode concept; the CLI uses a local JSON credential file.

**Report payload schemas (client-side types, not enforced by relay):**

```typescript
// report_type: "daily_briefing"
interface DailyBriefingReport {
  reportType: 'daily_briefing';
  goals: string[];
  progress: string;
  blockers: string[];
  nextSteps: string[];
  metrics: {
    tokensUsed?: number;
    tasksCompleted?: number;
    errorsEncountered?: number;
  };
  generatedAt: string; // ISO 8601
}

// report_type: "ralph_loop"
interface RalphLoopReport {
  reportType: 'ralph_loop';
  iteration: number;
  baselineMetrics: Record<string, number>;
  currentMetrics: Record<string, number>;
  delta: Record<string, number>;
  whatChanged: string;
  cumulativeProgress: string;
  generatedAt: string;
}
```

---

### RemoteAdapter (new class in extension, src/adapters/)

Implements `AgentBackendAdapter` interface. Talks to relay instead of local agent. Uses polling rather than event streaming.

```typescript
class RemoteAdapter implements AgentBackendAdapter {
  readonly id = 'remote';
  readonly name = 'Remote (Relay)';

  private pollInterval: NodeJS.Timeout | undefined;
  private readonly relayClient: RelayClient; // thin HTTP wrapper
  private readonly channelId: string;
  private _onDidReceiveEvent: vscode.EventEmitter<AgentEvent>;

  constructor(config: RemoteWorkspaceConnectionConfig) { ... }

  async connect(workspaceId: string, _rootPath: string): Promise<void> {
    // Start polling loop for status/reports
    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async disconnect(workspaceId: string): Promise<void> {
    clearInterval(this.pollInterval);
  }

  private async poll(): Promise<void> {
    // Fetch latest report from relay, synthesize AgentEvent, emit via onDidReceiveEvent
    // This is a synthetic event — remote adapters produce "status" events, not raw hook events
  }

  get onDidReceiveEvent() { return this._onDidReceiveEvent.event; }
  dispose() { ... }
}
```

`RemoteAdapter` emits synthetic `AgentEvent` objects derived from report data. This is the bridge that lets the existing `handleEvent()` pipeline in `extension.ts` accept remote data without modification. The event types emitted will be a subset (status updates, not raw tool-use hooks).

---

### ReportPanel (new panel in extension, src/panels/)

A new `vscode.WebviewPanel` for viewing remote workspace reports. Not a replacement for `DashboardPanel` — it serves a different purpose (historical report timeline vs. live event stream).

```
ReportPanel
  ├── Timeline view          Ordered list of daily briefing reports
  ├── RalphLoopChart         Progress chart (iteration × metric value) using D3 or Chart.js
  └── MessageComposer        Text input to post feedback messages to relay
```

Commands that open it: `harnesstune.showReports` (new command).

---

## Modified Components

### src/types/workspace.ts — BackendType and WorkspaceRecord

```typescript
// Before
export type BackendType = 'claude-code' | 'openclaw';

// After
export type BackendType = 'claude-code' | 'openclaw' | 'remote';

// WorkspaceRecord gets two new optional fields:
export interface WorkspaceRecord {
  // ... existing fields unchanged ...
  backendType: BackendType;
  connectionConfig?: {
    host?: string;
    port?: number;
    relayUrl?: string;   // NEW: relay base URL for remote workspaces
    channelId?: string;  // NEW: relay channel ID for remote workspaces
    // authToken remains in SecretStore, keyed by workspaceId
  };
}
```

The `IWorkspaceRegistry.add()` signature needs a new overload or extended options object to accept `relayUrl` and `channelId` for remote workspaces. `rootPath` becomes optional (or set to a sentinel like `'remote'`) for remote workspaces since there is no local path.

### src/adapters/AdapterFactory.ts — WorkspaceConnectionConfig

```typescript
// Before
export type BackendType = 'claude-code' | 'openclaw';
export interface WorkspaceConnectionConfig {
  backendType: BackendType;
  host: string;
  port?: number;
  authToken?: string;
}

// After
export type BackendType = 'claude-code' | 'openclaw' | 'remote';
export interface WorkspaceConnectionConfig {
  backendType: BackendType;
  host: string;
  port?: number;
  authToken?: string;
  relayUrl?: string;    // only for 'remote'
  channelId?: string;   // only for 'remote'
}
```

### src/adapters/AdapterRegistry.ts — register 'remote' factory

In `extension.ts` activate(), add:

```typescript
adapterRegistry.register('remote', {
  createAdapter: (config) => new RemoteAdapter(config, secretStore)
});
```

No changes to `AdapterRegistry` class itself. The factory pattern already handles arbitrary backend types.

### src/types/messages.ts — new postMessage types

Add to `HostToWebviewMessage`:

```typescript
| { type: 'reports:list'; workspaceId: string; reports: ReportDocument[] }
| { type: 'reports:detail'; report: ReportDocument }
| { type: 'reports:messageSent'; workspaceId: string }
```

Add to `WebviewToHostMessage`:

```typescript
| { type: 'workspace:addRemote'; name: string; relayUrl: string; channelId: string }
| { type: 'reports:request'; workspaceId: string; reportType?: string }
| { type: 'reports:sendMessage'; workspaceId: string; body: string }
```

### src/panels/SidebarViewProvider.ts — handle addRemote message

The sidebar webview needs a new flow for adding remote workspaces (relay URL + token input instead of folder picker). The host-side handler in `SidebarViewProvider.resolveWebviewView()` adds a case for `workspace:addRemote` that calls `registry.add()` with `backendType: 'remote'`.

The sidebar webview React component (`dist/webview/sidebar.js`) needs a UI path to add remote workspaces — a separate button or context menu item from the local "Connect Workspace" folder picker.

### src/registry/WorkspaceRegistry.ts — accept remote workspace fields

The `add()` method needs to accept `relayUrl` and `channelId` and persist them in `WorkspaceRecord.connectionConfig`. The JSON schema is already open (connectionConfig is optional with optional sub-fields), so this is a field addition, not a schema break.

### extension.ts — new command and auto-poll wiring

Two additions:
1. Register `harnesstune.addRemoteWorkspace` command that runs the add-remote flow (relay URL + token, calls relay to verify channel exists, stores token in SecretStore keyed by `workspaceId`).
2. Register `harnesstune.showReports` command that opens `ReportPanel` for the selected workspace.

The `connectWorkspace()` function already routes by `backendType` — remote workspaces will automatically instantiate `RemoteAdapter` via `adapterRegistry.create()` with no additional conditional logic needed.

---

## Data Flow

### Adding a remote workspace (one-time setup)

```
User                Extension (host)              SecretStore        Relay
 |                       |                            |                |
 |-- enter relay URL  -->|                            |                |
 |-- enter token ------->|                            |                |
 |                       |-- GET /api/channels/:id -->|--------------->|
 |                       |<-- channel metadata -------|<---------------|
 |                       |-- store token in --->----->|                |
 |                       |   SecretStore[workspaceId] |                |
 |                       |-- registry.add(remote) --->|                |
 |                       |-- connectWorkspace() ----->|                |
 |                       |   (instantiates RemoteAdapter, starts poll) |
 |<-- sidebar updated ---|                            |                |
```

### Report upload (agent machine → extension)

```
Agent Machine                    Relay (Turso)            Extension (polling)
     |                               |                          |
     | [scheduler fires]             |                          |
     |-- POST /channels/:id/reports ->|                          |
     |                               |-- INSERT reports -------->|
     |                               |                          |
     |                               |   [poll interval fires]  |
     |                               |<-- GET /channels/:id/reports
     |                               |                          |
     |                               |-- 200 [report list] ---->|
     |                               |                          |-- emit synthetic AgentEvent
     |                               |                          |-- handleEvent() pipeline
     |                               |                          |-- ReportPanel.postMessage()
```

### Async message (extension → agent)

```
User (ReportPanel)    Extension host          Relay           Agent CLI
      |                    |                    |                 |
      |-- sendMessage ----->|                    |                 |
      |                    |-- POST /messages -->|                 |
      |                    |                    |-- INSERT ------->|
      |                    |<-- 201 ok ----------|                 |
      |<-- messageSent -----|                    |                 |
      |                    |                    |   [poll fires]   |
      |                    |                    |<-- GET /messages-|
      |                    |                    |-- 200 [msgs] --->|
      |                    |                    |                 |-- InstructionRouter
      |                    |                    |                 |-- DELETE /messages/:id (ack)
```

### Local workspaces (unchanged)

Local workspaces continue to use `ClaudeCodeHookAdapter` (HTTP hook server) and `OpenClawAdapter` (JSONL file tail). The `handleEvent()` pipeline in `extension.ts` is shared — both local and remote adapters emit `AgentEvent` objects into the same handler. Local adapters emit rich real-time events; remote adapters emit periodic synthetic status events.

---

## Database Schema

Two separate databases — no schema coupling between them:

**Extension (local, sql.js SQLite at globalStorageUri) — unchanged:**

```
agent_events table — unchanged, stores local hook events only
```

Remote report data is NOT stored in the extension's local SQLite. Reports are fetched from the relay on demand and cached in-memory in `RemoteAdapter`. If persistence of remote reports is needed in v2 (for offline viewing), that is deferred to a future iteration.

**Relay (Turso cloud SQLite) — new:**

```
channels    — one row per registered remote agent workspace
tokens      — one row per API token (hashed), FK to channels
reports     — one row per uploaded report document, FK to channels
messages    — one row per async message (both directions), FK to channels
```

See full DDL in New Components > harnesstune-relay section above.

**WorkspaceRegistry JSON (globalStorageUri/workspaces.json) — additive change:**

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "...",
      "name": "Remote Agent — Prod Mac",
      "rootPath": "remote",
      "backendType": "remote",
      "connectionConfig": {
        "relayUrl": "https://relay.harnesstune.dev",
        "channelId": "abc-123"
      }
    }
  ]
}
```

The `authToken` is never in the JSON. It lives in `SecretStore` keyed by `workspaceId`. This is consistent with how v1.0 handles auth tokens for other adapters.

---

## Build Order

Dependencies drive this order. Each step unblocks the next.

### Step 1: Relay API (harnesstune-relay)

Build first. Everything else depends on it being callable.

- Set up Vercel project + Turso database
- Implement Turso schema migrations
- Implement REST endpoints (channels, reports, messages)
- Implement token hash validation middleware
- Deploy to Vercel (staging environment)
- Write integration tests against staging

**Output:** A live relay URL that agent CLI and extension can talk to.

### Step 2: Agent CLI (harnesstune-agent)

Build second, against the live relay.

- Implement `RegistrationClient` (POST /channels, persist credential file)
- Implement `LocalAdapterDelegate` for at least one adapter type (daily briefing from JSONL or log files)
- Implement `ReportScheduler` with configurable interval
- Implement `MessagePoller`
- Implement `InstructionRouter` (stub is acceptable for v2 — log received messages, full routing in v2.1)
- Publish as npm package for `npx` usage

**Output:** An agent running on a remote machine can register, upload reports, and receive messages.

### Step 3: Extension type changes

Before writing any extension code, lock the TypeScript types that span all extension components. Doing this before UI and adapter work prevents type churn.

- Add `'remote'` to `BackendType` union in `src/types/workspace.ts` and `src/adapters/AdapterFactory.ts`
- Add `relayUrl`, `channelId` to `WorkspaceConnectionConfig` and `WorkspaceRecord.connectionConfig`
- Add new `HostToWebviewMessage` and `WebviewToHostMessage` variants for reports and remote workspace management
- Add `ReportDocument`, `DailyBriefingReport`, `RalphLoopReport` types to `src/types/`

**Output:** Type-checked foundation for steps 4–6.

### Step 4: RemoteAdapter

Build the adapter after types are locked and relay is live (for real integration testing).

- Implement `RelayClient` HTTP wrapper (thin fetch wrapper, handles auth header)
- Implement `RemoteAdapter` with polling loop
- Implement synthetic `AgentEvent` synthesis from report data
- Register `'remote'` factory in `extension.ts` `adapterRegistry`
- Integration test: connect a real relay channel, verify polling emits events

**Output:** Extension can connect to a remote workspace and receive status updates.

### Step 5: WorkspaceRegistry + add-remote command

Extend the registry and add the user-facing flow for registering a remote workspace.

- Update `WorkspaceRegistry.add()` to accept and persist `relayUrl`, `channelId`
- Implement `harnesstune.addRemoteWorkspace` command (relay URL input → token input → relay channel verification → SecretStore storage → registry.add)
- Update `SidebarViewProvider` to handle `workspace:addRemote` message
- Update sidebar React component with "Add Remote Workspace" UI path

**Output:** User can add a remote workspace from the sidebar. It appears in the list and polls for status.

### Step 6: ReportPanel + report viewer UI

Build the UI last — it depends on the adapter (step 4) providing data and the message types (step 3) being stable.

- Implement `ReportPanel` WebviewPanel with serializer
- Implement React components: `ReportTimeline`, `RalphLoopChart`, `MessageComposer`
- Wire `harnesstune.showReports` command in `extension.ts`
- Wire message handler for `reports:sendMessage` (calls relay POST /messages)
- Handle sidebar click on remote workspace → open ReportPanel (vs. local workspace → open ChatPanel)

**Output:** Full read/write UI for remote agent management.

### Step 7: End-to-end validation

- Remote machine runs `npx harnesstune-agent` with real relay
- Extension adds that remote workspace
- Reports uploaded by CLI appear in ReportPanel timeline
- Message sent from ReportPanel is received and logged by CLI's InstructionRouter
- Local workspaces continue to operate normally alongside remote ones in sidebar

---

## Integration Points with v1.0 Code

| v1.0 Component | Change Type | What Changes |
|---|---|---|
| `AgentBackendAdapter` interface | None | `RemoteAdapter` implements as-is |
| `AdapterRegistry` | None | `register('remote', factory)` call added in extension.ts |
| `AdapterFactory.WorkspaceConnectionConfig` | Additive | Add `relayUrl?`, `channelId?` fields |
| `WorkspaceRecord` / `BackendType` | Additive | Add `'remote'` to union, add fields to `connectionConfig` |
| `WorkspaceRegistry` | Additive | `add()` accepts new connection fields |
| `extension.ts` `connectWorkspace()` | None | Already routes by backendType; auto-handles 'remote' |
| `extension.ts` `handleEvent()` | None | Accepts synthetic events from RemoteAdapter unchanged |
| `SecretStore` | None | Used as-is, keyed by workspaceId |
| `SidebarViewProvider` | Additive | New message case for `workspace:addRemote` |
| `HostToWebviewMessage` / `WebviewToHostMessage` | Additive | New variants for reports and remote workspace ops |
| `DashboardPanel` | None | Not used for remote workspaces |
| `SchematicPanel` | None | Not used for remote workspaces (no topology data from relay) |
| `AgentEventStore` (local SQLite) | None | Not used for remote report persistence in v2 |
| `HookServer` | None | Local adapter only; not involved in remote path |
| `AgentControlManager` | None | pause/resume/stop remain local-only in v2 |
