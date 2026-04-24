# ROADMAP: HarnessTune

**Project:** HarnessTune — VSCode Extension for Agent Harness Engineering
**Core Value:** Engineers running multiple agent systems can see the health, topology, and status of every agent across every workspace — and interact with any of them — from one place inside VSCode.
**Created:** 2026-04-16
**Status:** Active

---

## Milestone 1: Core Agent IDE

All five phases below constitute Milestone 1. Completion delivers a functional, dogfoodable agent IDE covering workspace management, live Claude Code monitoring, interactive topology visualization, embedded terminal chat, and workspace scaffolding with a second adapter.

---

## Phases (Milestone 1)

- [x] **Phase 1: Foundation — Extension Scaffold, Registry, Sidebar** - Extension loads, workspaces can be added/removed, sidebar renders with status indicators
- [x] **Phase 2: Claude Code Adapter + Dashboard** - First end-to-end data pipeline from Claude Code hooks through to live dashboard display with agent controls
- [x] **Phase 3: Agent Schematic (Live Topology)** - Interactive D3/React Flow graph showing real-time agent hierarchy reconstructed from hook events
- [x] **Phase 4: Chat Interface + Terminal** - Embedded terminal per workspace routing to the configured LLM backend
- [x] **Phase 5: Workspace Scaffolding + OpenClaw Adapter** - Template-based workspace creation and a second adapter proving the adapter pattern generalizes

---

## Milestone 2: Remote Agent Management

Five phases (Phase 6 through Phase 10) constitute Milestone 2. Completion delivers a remote command center: engineers can monitor and communicate with agents running on any machine — through a relay/mailbox pattern — from the same HarnessTune sidebar where local workspaces appear.

---

## Phases (Milestone 2)

- [x] **Phase 6: Pre-Work — Type Consolidation + Monorepo** - Foundation cleanup that all v2.0 code depends on: single canonical BackendType, local/remote discriminant on WorkspaceRecord, registry v2 migration, monorepo structure
- [x] **Phase 7: Relay API** - Live Vercel + Turso relay deployed — the shared mailbox all other v2.0 components talk to
- [x] **Phase 8: Agent CLI + Daily Briefing Reports** - `npx harnesstune-agent` sidecar on remote machines: registers with relay, uploads structured briefing reports, polls for messages
- [x] **Phase 9: Extension Types + RemoteAdapter + Remote Workspace Management** - Type-safe bridge from relay data into extension: RemoteAdapter polling loop, ralph loop report types, sidebar add-remote flow with full connection management
- [x] **Phase 10: Report Timeline UI + Async Chat** - ReportPanel WebviewPanel: chronological feed of briefings, ralph loop cards, convergence chart, interleaved chat, message composer

---

## Phase Details

### Phase 1: Foundation — Extension Scaffold, Registry, Sidebar

**Goal:** Extension loads cleanly in VSCode, users can add and remove agent workspaces, and the sidebar renders each workspace with live status indicators and a status bar summary.

**Depends on:** Nothing (first phase)

**Requirements:** FOUN-01, FOUN-02, FOUN-03, FOUN-04, WKSP-01, WKSP-03, WKSP-04, WKSP-05, SIDE-01, SIDE-02, SIDE-03, SIDE-04, SIDE-05

**Key Deliverables:**
- Extension scaffold: TypeScript, esbuild dual-target build (extension host CJS + webview ESM), `package.json` with `HarnessTune:` command prefix
- Workspace registry: JSON schema at `globalStorageUri`, CRUD operations (connect existing directory, remove), absolute path storage, persistence across VSCode restarts
- File watcher pipeline: `RelativePattern` with absolute base path, debounce, health-refresh signal
- Sidebar `WebviewView`: React app, workspace list, status badges (color + shape, never color alone), agent tree, click-to-open workspace view
- Status bar item: running agent count + error badge
- `context.secrets` storage for API keys (never `globalState`)

**Success Criteria** (what must be TRUE when this phase completes):
1. User can connect an existing agent directory as a workspace; it persists and reappears after VSCode restarts
2. User can remove a workspace from the registry; it disappears from the sidebar immediately
3. Sidebar shows each workspace with a status badge that communicates state without relying on color alone
4. Clicking a workspace in the sidebar opens its workspace view in the editor area
5. Status bar item is visible and shows a running agent count (zero when no agents are active)

**Research Flag:** Standard patterns — skip research-phase. VSCode WebviewView, esbuild dual-target, and `RelativePattern` watchers are HIGH confidence and well-documented.

**Plans:** 3/3 plans executed

Plans:
- [x] 01-PLAN.md — Extension scaffold, esbuild build, shared type contracts
- [x] 02-PLAN.md — Workspace registry, file watchers, secrets storage
- [x] 03-PLAN.md — React sidebar WebviewView, status badges, status bar

---

### Phase 2: Claude Code Adapter + Dashboard

**Goal:** Claude Code hook events flow end-to-end into a live dashboard panel where users can inspect agent detail and pause, resume, or stop running agents.

**Depends on:** Phase 1

**Requirements:** DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, CTRL-01, CTRL-02, CTRL-03, CTRL-04, CCAD-01, CCAD-02, CCAD-03, CCAD-04, CCAD-05, CCAD-06, NOTF-01, NOTF-02, NOTF-03

**Key Deliverables:**
- Local HTTP server in extension host receiving Claude Code hook POSTs on all 24 lifecycle events
- `ClaudeCodeHookAdapter` implementing `AgentBackendAdapter` interface; auto-injects hook config into `~/.claude/settings.json` on connect, removes on disconnect
- Shared `AgentEvent` schema aligned to OTel GenAI semantic conventions
- `sql.js` SQLite database at `globalStorageUri` for agent events and token/cost data
- Dashboard `WebviewPanel` (React): aggregate health view across all workspaces, per-workspace summary cards (total agents, running, errors, cost), agent detail panel (role, model, status, current task, recent actions, config excerpt)
- Pause / Resume / Stop controls wired to Claude Code session management, accessible via both UI buttons and Command Palette
- Typed `postMessage` contracts (`HostToWebviewMessage` / `WebviewToHostMessage`) for all host-webview communication
- `WebviewPanelSerializer` so dashboard panels reopen after VSCode restarts
- Toast notifications for agent errors; status bar badge increments for informational events

**Success Criteria** (what must be TRUE when this phase completes):
1. Running a Claude Code agent session causes events to appear in the dashboard within 2 seconds, without any manual refresh
2. Agent detail panel shows the agent's current task, model, role, and last 5–10 actions sourced from real hook data
3. Clicking Pause on a running agent suspends it; clicking Resume restores it; clicking Stop cancels it — all three also work via Command Palette
4. Dashboard panel reopens with the last-known state after closing and reopening VSCode
5. An agent error triggers a VSCode toast notification; an informational event updates only the status bar badge

**Research Flag:** Needs validation before implementation — confirm that programmatic JSON merge into `~/.claude/settings.json` does not clobber existing user config. Test HTTP hook behavior under the known `CLAUDECODE=1` subprocess env var bug (claude-agent-sdk-python #573).

**Plans:** 4 plans

- [x] 02-01-PLAN.md — Type contracts, hook server, Claude Code adapter, jest setup
- [x] 02-02-PLAN.md — sql.js event store, agent controls, notification service
- [x] 02-03-PLAN.md — Dashboard WebviewPanel and React UI components
- [x] 02-04-PLAN.md — Extension wiring, WebviewPanelSerializer, Command Palette commands

---

### Phase 3: Agent Schematic (Live Topology)

**Goal:** An interactive topology graph renders in a webview panel, reconstructing the live agent hierarchy from Phase 2's hook event stream, with click-to-inspect and zoom/pan.

**Depends on:** Phase 2

**Requirements:** SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-05, SCHM-06

**Key Deliverables:**
- Schematic `WebviewPanel` (React + D3.js v7 or React Flow, decided during plan-phase research)
- Topology reconstruction from `SubagentStart`, `SubagentStop`, and `parent_tool_use_id` event fields
- Node types: orchestrator, subagent, tool call, data source, human checkpoint
- Hierarchical layout using dagre or d3-dag (evaluate d3-dag as maintained replacement for unmaintained dagre)
- Edge animation: traveling dot on message-in-flight between agents
- Click-to-inspect: clicking a node shows agent detail (role, status, config, instructions, recent actions) in a side panel; graph stays visible
- Zoom, pan, and "Fit to view" control; minimap for large graphs
- Schematic state persistence via `getState/setState` (not `retainContextWhenHidden`)

**Success Criteria** (what must be TRUE when this phase completes):
1. Running a multi-agent Claude Code session causes the topology graph to render the agent hierarchy within 3 seconds, sourced from real hook events (not mock data)
2. Clicking any node in the graph opens an info panel showing that agent's role, status, and recent actions without navigating away from the graph
3. Zoom in, zoom out, and "Fit to view" all work; the graph can be panned by dragging
4. Edges animate to indicate an active message-in-flight between a parent and subagent
5. The graph uses a hierarchical top-down layout by default

**Research Flag:** Needs research-phase during planning — (1) React Flow commercial licensing: verify MIT terms apply to HarnessTune's distribution before committing; if commercial license required, use D3.js directly. (2) `dagre` vs `d3-dag` vs `elkjs`: dagre is unmaintained (last commit 2021); confirm replacement before implementation.

**Plans:** 3/3 plans executed

Plans:
- [x] 03-01-PLAN.md — Topology types, AgentEvent extension, topologyReducer, shared AgentDetailPanel
- [x] 03-02-PLAN.md — SchematicPanel host class, React SVG graph components, CSS
- [x] 03-03-PLAN.md — Extension wiring, serializer, event pipeline, human verification


---

### Phase 4: Chat Interface + Terminal

**Goal:** Each workspace has an embedded terminal that routes user input to the workspace's configured LLM backend and streams output back.

**Depends on:** Phase 1 (workspace registry), Phase 2 (backend adapter routing)

**Requirements:** CHAT-01, CHAT-02, CHAT-03, CHAT-04

**Key Deliverables:**
- Embedded terminal per workspace using VSCode native `Pseudoterminal` API (not `node-pty` — deferred to v2)
- Terminal routes to the workspace's configured backend (Claude Code for v1)
- `retainContextWhenHidden: true` on the terminal panel only (PTY reconnect complexity justifies the memory cost; data panels use `getState/setState` instead)
- User can type commands and receive streaming responses within the terminal; session context persists when the terminal panel is hidden

**Success Criteria** (what must be TRUE when this phase completes):
1. Opening a workspace's terminal panel shows a live terminal session connected to that workspace's configured backend
2. Typing a command and pressing Enter sends it to Claude Code and streams the response back into the terminal
3. Hiding the terminal panel and reopening it restores the session without losing context or requiring reconnection
4. Each workspace has its own independent terminal session; switching workspaces switches terminals

**Research Flag:** Standard patterns — skip research-phase. VSCode native `Pseudoterminal` API is HIGH confidence. Note: if users later require the terminal embedded inline within the schematic panel (rather than in the VSCode terminal area), that requires `xterm.js` + `node-pty` and is a v2 decision requiring explicit validation.

**Plans:** 2 plans

Plans:
- [x] 04-01-PLAN.md — Pseudoterminal class, stream-JSON parser, output formatter
- [x] 04-02-PLAN.md — ChatManager, ChatPanel, extension wiring, openTerminal command, interrupt support

---

### Phase 5: Workspace Scaffolding + OpenClaw Adapter

**Goal:** Users can scaffold a new workspace from a template with a single command, and OpenClaw agent events flow into the dashboard, proving the adapter pattern generalizes beyond Claude Code.

**Depends on:** Phase 1 (registry schema stable), Phase 2 (adapter interface proven)

**Requirements:** WKSP-02 (v1 scaffold requirement), plus OpenClaw adapter groundwork

**Key Deliverables:**
- Template-based workspace scaffolding: creates `CLAUDE.md`, `.claude/settings.json`, `context/`, `work-log/` directories from templates with variable substitution (`{{AGENT_NAME}}`, `{{AGENT_ROLE}}`, `{{CREATED_DATE}}`, `{{MODEL}}`)
- Post-scaffold flow: validate files created, register workspace in registry, attach `FileSystemWatcher`, open dashboard panel automatically
- `OpenClawAdapter`: tail `~/.openclaw/agents/<agentId>/sessions/*.jsonl` via `chokidar`; parse nd-JSON incrementally; normalize to shared `AgentEvent` schema
- Agent identity convention defined before implementation: `AgentRecord.id` format that handles both named agents and parallel instances (e.g., multiple concurrent runs of the same agent type)

**Success Criteria** (what must be TRUE when this phase completes):
1. Running "HarnessTune: Create Workspace" scaffolds a new workspace directory with all template files populated correctly and registers it automatically — no manual registry step required
2. The scaffolded workspace appears in the sidebar immediately after creation with the correct initial status
3. Running an OpenClaw agent session causes its events to appear in the HarnessTune dashboard, normalized to the same display format as Claude Code events
4. The adapter selector in workspace settings allows switching between Claude Code and OpenClaw backends

**Research Flag:** Needs decision before implementation — agent identity vs. parallel instances. If multiple instances of the same agent type can run simultaneously, the `AgentRecord.id` schema and graph node identity must account for it. Define the naming/grouping convention before finalizing the registry schema update for this phase.

**Plans:** 3 plans

Plans:
- [x] 05-01-PLAN.md — Type contracts, AdapterFactory/Registry, WorkspaceRecord migration, extension.ts refactor
- [x] 05-02-PLAN.md — ScaffoldService, bundled templates, createWorkspace command
- [x] 05-03-PLAN.md — OpenClawAdapter, OpenClawLogSession, ChatManager routing

---

### Phase 6: Pre-Work — Type Consolidation + Monorepo

**Goal:** The codebase is structurally ready for v2.0 feature work — duplicate type definitions are eliminated, the workspace registry can distinguish local from remote, and the repo is organized as a monorepo with cross-package type sharing in place.

**Depends on:** Phase 5 (Milestone 1 complete)

**Requirements:** PRWK-01, PRWK-02, PRWK-03, PRWK-04, PRWK-05

**Key Deliverables:**
- Package manager decision locked: pnpm workspaces vs npm workspaces vs turborepo — chosen in this phase, documented in architectural constraints, used by all subsequent phases
- `BackendType` consolidated to a single canonical definition in `src/types/workspace.ts`; re-exported from `src/adapters/AdapterFactory.ts`; `'remote'` added to the union; exhaustiveness check added to `AdapterRegistry.create()` via `never` assertion
- `WorkspaceRecord` gains `mode: 'local' | 'remote'` discriminant for TypeScript narrowing throughout the codebase
- Registry JSON migrated to version 2 schema: all existing records get `mode: 'local'`; `registry.load()` migration logic handles v1 → v2 upgrade transparently
- Monorepo root created: `packages/harnesstune-relay` and `packages/harnesstune-agent` package directories scaffolded with `package.json`, `tsconfig.json`, and stub entry points
- TypeScript project references configured at root level (`tsc --build` at root resolves dependency order: types → relay/agent → extension)

**Success Criteria** (what must be TRUE when this phase completes):
1. `tsc --build` at monorepo root succeeds with zero type errors — no duplicate BackendType definitions exist
2. Existing local workspaces load correctly after the registry migration; no data loss and no manual migration step required from the user
3. Adding `'openclaw'` or any new string to `BackendType` without registering a factory causes a TypeScript compile error (exhaustiveness enforced)
4. `packages/harnesstune-relay` and `packages/harnesstune-agent` are importable as workspace packages from the root
5. All existing Milestone 1 functionality (sidebar, dashboard, schematic, terminal, scaffolding) continues to work unchanged after the monorepo restructure

**Research Flag:** Standard patterns — skip research-phase. TypeScript project references, discriminated union migration, and monorepo restructuring are HIGH confidence and well-documented.

**Plans:** 2/2 plans executed

Plans:
- [x] 06-01-PLAN.md — Type consolidation (BackendType canonical + mode discriminant + registry v2 migration)
- [x] 06-02-PLAN.md — Monorepo structure (pnpm workspaces + TS project references + package scaffolds)

---

### Phase 7: Relay API

**Goal:** A live relay is deployed on Vercel with Turso persistence — a dumb document store that agents and the extension can both reach over HTTPS, with token-based auth, paginated endpoints, and all security and operational constraints in the API contract from day one.

**Depends on:** Phase 6 (monorepo structure with `packages/harnesstune-relay` in place)

**Requirements:** RLAY-01, RLAY-02, RLAY-03, RLAY-04, RLAY-05, RLAY-06, RLAY-07, RLAY-08, RLAY-09, RLAY-10, RLAY-11, RLAY-12, RLAY-13, RLAY-14

**Key Deliverables:**
- Hono app in `packages/harnesstune-relay`; Vercel serverless deployment via `vercel.json`; Turso (SQLite) persistence via `@libsql/client ./http` subpath (per-request client initialization — not module-scope, to avoid stale connection on warm starts)
- Drizzle ORM schema: `channels`, `tokens`, `reports`, `messages` tables with full DDL and Drizzle migrations
- Token auth middleware: SHA-256 hash storage in `tokens` table; `crypto.timingSafeEqual` with length-normalized buffers for all comparisons; raw token shown once at registration and discarded
- `POST /api/channels` — agent registration; returns token once
- `GET /api/channels/:id` — channel metadata and health
- `POST /api/channels/:id/reports` — upload report JSON; 2MB agent-side enforcement; `413` with descriptive body if exceeded
- `GET /api/channels/:id/reports` — metadata-only paginated list (`?since=` cursor + `limit`); full body via `GET /api/channels/:id/reports/:id`
- `POST /api/channels/:id/messages` — post message (extension → agent)
- `GET /api/channels/:id/messages` — poll messages with `?since=` cursor (agent → extension)
- `DELETE /api/channels/:id/messages/:id` — acknowledge and clean up message
- `GET /health` — returns 200 + relay version; used by CLI and extension for connection verification
- `X-Agent-Version` header validation middleware — rejects agents below minimum compatible version with `426 Upgrade Required` and upgrade instructions
- `sanitizeHeaders` logger middleware — `Authorization` header redacted to `Bearer [REDACTED]` before any log output; token never appears in Vercel function logs
- Per-token rate limiting: 60 requests/minute sliding window per Bearer token; `429 Too Many Requests` with `Retry-After` header; protects against misconfigured agents burning through Vercel invocation quota
- One-command deployment: `vercel deploy` from `packages/harnesstune-relay`; documented Turso env var setup

**Success Criteria** (what must be TRUE when this phase completes):
1. `curl -H "Authorization: Bearer <token>" https://<relay>/health` returns `200` with relay version — relay is live and reachable
2. An agent can register (POST /api/channels), upload a report (POST .../reports), and the report is retrievable via paginated list and full-body fetch endpoints — full upload/download round trip works
3. A request with an invalid or missing token returns `401`; a request from an agent version below the minimum returns `426` with an upgrade message
4. The Vercel function logs contain `Bearer [REDACTED]` — no raw token appears in any log line
5. Running `vercel deploy` from `packages/harnesstune-relay` produces a live deployment with no manual configuration beyond documented environment variables

**Research Flag:** Standard patterns — skip research-phase. Turso + Hono + Vercel integration is officially documented with integration guides. All security patterns (timingSafeEqual, header sanitization) sourced from official Node.js and Hono documentation.

**Plans:** 3 plans

Plans:
- [x] 07-01-PLAN.md — Drizzle schema, Turso client, Hono app, middleware chain (auth, sanitize, version, rateLimit), health endpoint
- [x] 07-02-PLAN.md — Channel registration, report endpoints (upload, paginated list, full-body fetch), message endpoints (post, poll, delete)
- [ ] 07-03-PLAN.md — Vercel entry point, deployment config, schema push, live deployment verification

---

### Phase 8: Agent CLI + Daily Briefing Reports

**Goal:** `npx harnesstune-agent` is a working sidecar on remote machines — it registers with the relay, uploads structured daily briefing reports on a configurable schedule, polls for incoming messages, and manages its own lifecycle cleanly without orphaned processes or unbounded queues.

**Depends on:** Phase 7 (relay live and callable)

**Requirements:** ACLI-01, ACLI-02, ACLI-03, ACLI-04, ACLI-05, ACLI-06, ACLI-07, ACLI-08, ACLI-09, ACLI-10, ACLI-11, BRFG-01, BRFG-02, BRFG-03, BRFG-04

**Key Deliverables:**
- `packages/harnesstune-agent` npm package; `bin` entry point for `npx harnesstune-agent`; Node.js 20+ as only prerequisite
- Interactive `register` subcommand: prompts for relay URL, POSTs to `POST /api/channels`, stores channel ID + token in `.harnesstune/config.json`
- `ReportScheduler`: watches a well-known directory (`~/.harnesstune/reports/`) for new report JSON files; also supports reading from stdin; serializes and POSTs to relay
- Daily briefing report schema: `goals`, `progress`, `blockers`, `nextSteps`, `metrics` (tokensUsed, tasksCompleted, errorsEncountered), ISO 8601 `generatedAt`, UUID `reportId`; configurable schedule via cron expression or simple interval (default: daily)
- `MessagePoller`: short-polls `GET /api/channels/:id/messages` on configurable interval (default 60s); adds `Math.random() * 60_000` ms jitter per cycle and random first-poll delay to prevent thundering herd
- `InstructionRouter`: stub acceptable — logs received messages and routes to Claude Code via `claude` CLI for v2.0; full framework routing in v2.1
- Status heartbeat: uploads heartbeat every 5 minutes; extension marks workspace stale after 15 minutes without heartbeat (3 missed heartbeats)
- PID file management: writes to `~/.harnesstune/agent-<channelId>.pid` on startup; checks for live process on startup to prevent duplicate instances; `stop` subcommand sends SIGTERM via PID file
- `SIGTERM`, `SIGINT`, `SIGHUP` handlers: flush pending reports, delete PID file, upload "disconnected" status, `process.exit(0)`
- Bounded local retry queue: max 48 reports; disk-persisted as JSON in `~/.harnesstune/queue/`; exponential backoff on relay errors; rate-limited replay (minimum 5s between uploads) on relay recovery
- `--dry-run` flag: validates setup (config file, relay reachability, report schema) without uploading data
- `X-Agent-Version` header sent on all relay requests; `sanitizeHeaders` wrapper redacts `Authorization` in all CLI log output

**Success Criteria** (what must be TRUE when this phase completes):
1. `npx harnesstune-agent register` completes the interactive flow and creates `.harnesstune/config.json` — confirmed by inspecting the file after registration
2. After registration, placing a valid briefing JSON file in `~/.harnesstune/reports/` causes it to appear in `GET /api/channels/:id/reports` within one polling cycle
3. `npx harnesstune-agent --dry-run` exits cleanly with a validation summary and makes zero requests to the relay
4. Killing the agent process (SIGTERM) causes it to upload a "disconnected" status and delete the PID file before exit; restarting produces one process, not two
5. When the relay is unreachable, reports queue locally; when the relay recovers, queued reports upload with rate-limited replay — queue never exceeds 48 entries

**Research Flag:** Standard patterns — skip research-phase. Commander, node-cron, sidecar daemon pattern with PID file and signal handlers are established and well-documented.

**Plans:** 3 plans

Plans:
- [x] 08-01-PLAN.md — Shared report types, agent config module, HTTP client
- [x] 08-02-PLAN.md — CLI entry point, register, stop, report commands
- [x] 08-03-PLAN.md — Start command (sidecar loop, heartbeat, polling, retry queue)
---

### Phase 9: Extension Types + RemoteAdapter + Remote Workspace Management

**Goal:** Remote workspaces appear in the HarnessTune sidebar alongside local ones — engineers can add, configure, and remove them — and the RemoteAdapter polling loop delivers report data from the relay into the extension's existing event pipeline.

**Depends on:** Phase 6 (type foundation), Phase 7 (relay callable), Phase 8 (real data available from agent CLI for integration testing)

**Requirements:** RLPH-01, RLPH-02, RLPH-03, RLPH-04, RLPH-05, RWKS-01, RWKS-02, RWKS-03, RWKS-04, RWKS-05, RWKS-06, RWKS-07, RWKS-08, RWKS-09

**Key Deliverables:**
- New postMessage type variants (with `version` field on all types): `reports:list`, `reports:detail`, `reports:messageSent` added to `HostToWebviewMessage`; `workspace:addRemote`, `reports:request`, `reports:sendMessage` added to `WebviewToHostMessage`; version-mismatch handler triggers full state refresh
- `ReportDocument`, `DailyBriefingReport`, `RalphLoopReport` (with `loopId`, iteration, baseline/current/delta, `whatChanged`, `cumulativeProgress`, generic named-metric `Record<string, number>`) TypeScript types in `src/types/`
- `RelayClient`: thin `fetch` wrapper; `Authorization: Bearer <token>` header on all requests; 8s timeout for first poll, 5s thereafter; "connecting" state emitted during cold-start window; `Bearer [REDACTED]` in debug logs
- `RemoteAdapter`: implements `AgentBackendAdapter`; `setInterval` polling loop; emits synthetic `AgentEvent` objects derived from latest report data into existing `handleEvent()` pipeline; lazy full-body fetch (metadata only on poll, full body on demand); `'remote'` registered in `AdapterFactory` / `AdapterRegistry`
- `WorkspaceRegistry.add()` extended to accept `relayUrl` and `channelId` for remote workspaces; `rootPath` set to sentinel `'remote'`; auth token stored in `SecretStore` keyed by `workspaceId` — never in registry JSON
- `harnesstune.addRemoteWorkspace` command: QuickInput flow — relay URL → agent token (password mode) → `GET /health` verification → SecretStore storage → `registry.add()` → `connectWorkspace()` (instantiates RemoteAdapter, starts poll)
- Sidebar updated: remote workspaces render in the same list as local workspaces with a small "remote" icon; status indicators (running / idle / error / stale) derived from latest report data and heartbeat freshness; last-seen timestamp shown under workspace name; connection error handling distinguishes relay unreachable (network badge), token invalid (401 + re-configure prompt), stale data (dim + timestamp)
- Right-click context menu additions (conditional on `mode === 'remote'`): "Message Agent" opens async chat; "Configure" opens QuickInput for relay URL, poll interval, token update; "Remove" disconnects from registry (does not delete relay data)
- Sidebar React component: "Add Remote Workspace" UI path (separate from local "Connect Workspace" folder picker); `workspace:addRemote` message handler in `SidebarViewProvider`

**Success Criteria** (what must be TRUE when this phase completes):
1. "Add Remote Workspace" command completes the relay URL + token flow and the new workspace appears in the sidebar — confirmed by seeing it alongside local workspaces with a "remote" icon
2. The remote workspace status indicator updates (running / idle / stale) based on the latest report from the relay without any manual refresh
3. Right-clicking a remote workspace shows "Message Agent", "Configure", and "Remove" — all three are absent on local workspace context menus
4. Removing a remote workspace removes it from the sidebar; the relay data is unaffected (reports still retrievable via relay API)
5. A 401 from the relay surfaces as a re-configure prompt in the sidebar — not a generic "error" state — and a network error surfaces a distinct "relay unreachable" badge

**Research Flag:** Standard patterns — skip research-phase. Adapter interface pattern and sidebar extension are established in v1.0 codebase; RemoteAdapter and registry extension are additive changes only.

**Plans:** 1/2 plans executed

Plans:
- [x] 09-01-PLAN.md — Extension-side report types, RelayClient, RemoteAdapter, SecretStore + Registry extensions
- [ ] 09-02-PLAN.md — AddRemoteWorkspace command, extension.ts wiring, sidebar UI updates, human verification

---

### Phase 10: Report Timeline UI + Async Chat

**Goal:** Clicking a remote workspace opens the ReportPanel — a unified chronological feed of briefing reports, ralph loop cards, and chat messages — where engineers can read agent output and post replies, all in one panel.

**Depends on:** Phase 9 (RemoteAdapter providing data, message types stable, sidebar entry point wired)

**Requirements:** ACHAT-01, ACHAT-02, ACHAT-03, ACHAT-04, ACHAT-05, TMLN-01, TMLN-02, TMLN-03, TMLN-04, TMLN-05, TMLN-06, TMLN-07, TMLN-08

**Key Deliverables:**
- `ReportPanel` `WebviewPanel` with `WebviewPanelSerializer`; opened via `harnesstune.showReports` command; wired to sidebar click on remote workspace (vs. local workspace → ChatPanel)
- `ReportTimeline` React component: chronological feed, newest first; interleaves briefing report cards, ralph loop report cards, and chat bubbles in one feed; report type filter tabs (All / Briefings / Ralph / Chat) persisted in webview state
- `BriefingReportCard`: collapsible sections for goals, progress, next steps, metrics; blocker call-out box rendered prominently in amber/red when `blockers` field is non-empty; "Reply" button pre-fills composer with `in_reply_to_report_id`
- `RalphLoopReportCard`: renders iteration number, loop ID, `whatChanged`, `cumulativeProgress`; baseline/current/delta table with +/- color coding (green positive, red negative)
- `RalphLoopChart` (D3 line chart): x-axis = iteration number, y-axis = metric value, one line per named metric; rendered in webview with correct CSP configuration for D3 in sandboxed context (prototype CSP adjustments before committing full scope)
- `MessageComposer`: text input with send button; POSTs to relay `POST /api/channels/:id/messages`; wires `reports:sendMessage` → extension host → `RelayClient.postMessage()`
- Async chat: engineer posts message from extension → relay → agent CLI polls and receives → agent response posted via CLI → extension fetches on next poll → rendered as chat bubble in timeline; messages scoped per workspace (channel ID = workspace ID); `delivered_at` and `replied_at` timestamps displayed; conversation history (last 50 messages)
- Paginated load: last 20 reports on panel open; "Load more" button fetches older history via `?since=` cursor

**Success Criteria** (what must be TRUE when this phase completes):
1. Clicking a remote workspace in the sidebar opens the ReportPanel showing a chronological feed — briefing cards, ralph loop cards, and chat bubbles appear in the same timeline
2. A briefing report with non-empty `blockers` renders a visually prominent call-out box (not just text buried in the card body)
3. The convergence chart renders a D3 line chart with one line per metric across iterations — confirmed by uploading two or more ralph loop iteration reports and seeing them plotted
4. Posting a message from the ReportPanel composer results in that message appearing in the agent CLI's inbox on next poll — confirmed end-to-end through the relay
5. The report type filter tabs correctly isolate briefings, ralph loop reports, and chat messages; "Load more" loads older reports beyond the initial 20

**Research Flag:** Standard patterns — skip research-phase. Convergence chart uses same pattern as Phase 3 schematic: d3-hierarchy runs in extension host, outputs coordinates, React renders SVG in webview. No D3 loaded in webview, no CSP concerns.

**Plans:** 2 plans

Plans:
- [ ] 06-01-PLAN.md — Type consolidation (BackendType canonical + mode discriminant + registry v2 migration)
- [ ] 06-02-PLAN.md — Monorepo structure (pnpm workspaces + TS project references + package scaffolds)

---

---

## Milestone 3: Multi-Platform Agent Fleet Management

Seven phases below constitute Milestone 3. Completion delivers a centralized control plane where the user checks in every few days to see how their agent fleet performed across multiple remote Macs running Paperclip, Claude Code/Desktop, and OpenClaw.

---

### Phase 11: Multi-Agent Model + Relay Extensions

**Goal:** The data model supports multiple agents per workspace, and the relay can store and serve per-agent run history. This is the foundation for all platform adapters.

**Depends on:** Phase 10 (v2.0 complete)

**Requirements:** MAWM-01, MAWM-02, MAWM-03, MAWM-04, RLYX-01, RLYX-02, RLYX-03, RLYX-04

**Key Deliverables:**
- `AgentIdentity` type: `id`, `name`, `schedule`, `platform`, `lastRunAt`, `status`
- `WorkspaceRecord` extended with `agents: AgentIdentity[]`
- `RunReport` type in `@harnesstune/shared`: `agentId`, `startedAt`, `finishedAt`, `status`, `durationMs`, `logs`, `errorSummary`, `tokenUsage`, `costCents`
- Relay schema migration: `agent_runs` table (channelId, agentId, startedAt, finishedAt, status, durationMs, logExcerpt, errorSummary, tokenUsage, costCents)
- Relay endpoints: `GET /channels/:id/agents`, `GET /channels/:id/agents/:agentId/runs`, `GET /channels/:id/summary?days=N`
- Reports endpoint extended with `agentId` filter parameter
- Registry migration v2→v3: existing single-agent workspaces get a default agent entry

**Success Criteria:**
1. A channel can have multiple agents registered; `GET /channels/:id/agents` returns the list
2. Run reports uploaded with `agentId` are retrievable filtered by that agent
3. `GET /channels/:id/summary?days=3` returns aggregated run counts, success rate, and cost per agent
4. Existing v2.0 workspaces load correctly after migration — backward compatible

**Research Flag:** Standard patterns — skip research. Drizzle migration, type extension, REST endpoint addition are all well-established.

**Plans:** 2/2 plans complete

Plans:
- [x] 11-01-PLAN.md — RunReport shared type, relay schema (agents + agent_runs tables), relay endpoints (agents, runs, summary, reports agentId filter)
- [x] 11-02-PLAN.md — AgentIdentity type, registry v2→v3 migration, RelayClient agent/run/summary methods, RemoteAdapter agent polling

---

### Phase 12: Collector Daemon + Easy Setup

**Goal:** A single `harnesstune-collector` process runs on a remote Mac, replaces the per-agent sidecar, and provides guided onboarding. Platform plugins register but are stubs — real implementations come in subsequent phases.

**Depends on:** Phase 11

**Requirements:** COLL-01, COLL-02, COLL-03, COLL-04, MAWM-05

**Key Deliverables:**
- `packages/harnesstune-collector` package in monorepo
- `npx harnesstune-collector setup` — guided onboarding: relay URL, token (auto-registers channel), platform auto-detection (checks for Paperclip, Claude Desktop, Claude Code, OpenClaw installations)
- Daemon mode with machine-level heartbeat (every 5 minutes)
- Platform plugin interface: `discover()` → `AgentIdentity[]`, `collectRuns(since: Date)` → `RunReport[]`, `setup()` → interactive config
- Plugin loader: reads `~/.harnesstune/collector.json` for enabled platforms + platform-specific config
- Stub plugins for all 4 platforms (discover returns empty, collectRuns returns empty)
- `harnesstune-collector start` / `stop` / `status` subcommands
- Launchd plist generator for macOS (`harnesstune-collector install`) — auto-start on login

**Success Criteria:**
1. `npx harnesstune-collector setup` on a fresh Mac detects installed platforms and writes config
2. `harnesstune-collector start` runs as daemon, sends heartbeat to relay every 5 minutes
3. `harnesstune-collector install` creates a launchd plist that survives reboot
4. Plugin interface is defined and stub plugins load without error

**Research Flag:** Needs research — launchd plist best practices for Node.js daemons on macOS; whether to use `launchctl` directly or a helper like `node-mac-permissions`.

**Plans:** 2/2 plans complete

Plans:
- [x] 12-01-PLAN.md — Package scaffold, PlatformPlugin interface, 4 stub plugins, config module, retry queue, relay client, daemon heartbeat + scheduler
- [x] 12-02-PLAN.md — CLI entry point, 5 subcommands (setup, start, stop, status, install), daemon loop integration

---

### Phase 13: Paperclip Adapter

**Goal:** The collector's Paperclip plugin pulls agent data, run history, and cost metrics from a Paperclip instance via its REST API, and reports them through the relay.

**Depends on:** Phase 12

**Requirements:** PCLP-01, PCLP-02, PCLP-03, PCLP-04, PCLP-05, PCLP-06, COLL-05, COLL-06

**Key Deliverables:**
- Paperclip collector plugin implementing the platform plugin interface
- `setup()`: prompts for Paperclip server URL + Board API Key, validates connection
- `discover()`: calls `GET /companies/:companyId/agents`, maps to `AgentIdentity[]` with heartbeat schedules
- `collectRuns(since)`: calls `GET /agents/:id/task-sessions` + `heartbeat_runs` data, maps to `RunReport[]`
- Cost enrichment: calls `GET /companies/:companyId/costs/by-agent?from=&to=` for token/cost data per run
- Activity mapping: calls `GET /companies/:companyId/activity?agentId=` for audit trail events
- Historical backfill on first connect (last 7 days)

**Success Criteria:**
1. Collector discovers all agents from a live Paperclip instance and registers them in the relay
2. Run history from the last 7 days appears in the relay with correct per-agent attribution
3. Cost data (tokens, cost in cents) is present on run reports for agents that incurred LLM usage
4. New runs that complete after collector start are detected and uploaded within one poll cycle

**Research Flag:** Needs validation — confirm Paperclip's `GET /agents/:id/task-sessions` response shape and pagination. Board API Key permissions may need specific scope.

---

### Phase 14: Claude Desktop + Claude Code Cron Adapters

**Goal:** The collector discovers and reports on Claude Desktop scheduled tasks and Claude Code cron jobs running on the same Mac.

**Depends on:** Phase 12

**Requirements:** CDSK-01, CDSK-02, CDSK-03, CDSK-04, CDSK-05, CDSK-06, CCCR-01, CCCR-02, CCCR-03, CCCR-04, CCCR-05, COLL-05, COLL-06

**Key Deliverables:**
- **Claude Desktop plugin:**
  - `setup()`: auto-detects `~/Library/Application Support/Claude/local-agent-mode-sessions/`, prompts to select orgId/userId if multiple
  - `discover()`: reads `scheduled-tasks.json`, maps entries to `AgentIdentity[]` with cron expressions
  - `collectRuns(since)`: parses `local_*.json` session files, correlates to tasks by `initialMessage` matching + timestamp proximity to `lastScheduledFor`
  - File watcher on `scheduled-tasks.json` for near-real-time run detection
  - Extracts per-run: timestamps, duration, model, conversation length, tool call count
  - Historical backfill (last 7 days of session files)

- **Claude Code cron plugin:**
  - `setup()`: generates `harnesstune-wrap` shell script, shows user how to update crontab
  - `discover()`: parses `crontab -l`, filters for `claude` CLI invocations, maps to `AgentIdentity[]`
  - `harnesstune-wrap`: wrapper that captures exit code, duration, stdout/stderr summary, uploads run report
  - Manual agent registration fallback via `harnesstune-collector add-agent --name "..." --cron "..."`
  - Historical backfill from wrapper logs (last 7 days)

**Success Criteria:**
1. Collector discovers all enabled scheduled tasks from Claude Desktop's `scheduled-tasks.json`
2. After a Desktop scheduled task runs, the run report appears in the relay within one poll cycle with correct task attribution
3. A cron job using `harnesstune-wrap` uploads a run report with exit code, duration, and log excerpt
4. Manual `add-agent` registration works for cron jobs that don't use the wrapper
5. Historical backfill populates the last 7 days of runs on first connect

**Research Flag:** Needs research — Claude Desktop session file format may vary across versions. Need to confirm `initialMessage` field reliability for task correlation. Also: `crontab -l` parsing edge cases (env vars, comments, special syntax).

**Plans:** 3/3 plans complete

Plans:
- [x] 14-01-PLAN.md — Claude Desktop types, mappers, reader (file I/O utilities)
- [x] 14-02-PLAN.md — Claude Code Cron types, mappers, crontab parser, wrapper script generator
- [x] 14-03-PLAN.md — Full plugin implementations (ClaudeDesktopPlugin, ClaudeCodePlugin) + loader wiring

---

### Phase 15: OpenClaw Remote Adapter

**Goal:** The collector discovers and reports on OpenClaw agents running on the remote Mac, extending the v1.0 local JSONL tailing pattern to work remotely via the relay.

**Depends on:** Phase 12

**Requirements:** OCLW-01, OCLW-02, OCLW-03, OCLW-04, COLL-05, COLL-06

**Key Deliverables:**
- OpenClaw collector plugin implementing the platform plugin interface
- `setup()`: auto-detects `~/.openclaw/agents/`, prompts for directory if non-standard
- `discover()`: lists `~/.openclaw/agents/` subdirectories, maps each to `AgentIdentity`
- `collectRuns(since)`: tails JSONL files via chokidar, segments sessions by time gaps, builds `RunReport[]`
- Run segmentation heuristic: new session = gap > 5 minutes between events (configurable)
- Historical backfill: scans JSONL files for sessions in last 7 days

**Success Criteria:**
1. Collector discovers all OpenClaw agents from the filesystem
2. JSONL events are segmented into discrete runs and uploaded to relay with correct agent attribution
3. Historical backfill populates the last 7 days of runs on first connect
4. New JSONL writes are detected in near-real-time via file watcher

**Research Flag:** Standard patterns — skip research. Reuses v1.0 chokidar JSONL tailing; only new work is run segmentation and relay integration.

---

### Phase 16: Fleet Dashboard + Historical Reporting UI

**Goal:** The extension's Dashboard and Reports panels are redesigned for the multi-agent fleet model — aggregate fleet view, per-workspace agent list, per-agent run history with multi-day summaries.

**Depends on:** Phase 11 (data model), Phase 13/14/15 (at least one adapter producing data)

**Requirements:** FDSH-01, FDSH-02, FDSH-03, FDSH-04, FDSH-05, FDSH-06

**Key Deliverables:**
- Fleet overview: platform cards with agent count, last activity, error rate across all workspaces
- Workspace drill-down: agent list with per-agent status, last run time, success rate sparkline
- Agent detail: run history table (timestamp, duration, status, cost, expandable log excerpt)
- Date range selector (24h / 3 days / 7 days / 30 days) filtering all views
- Agent health indicators: green/yellow/red/gray based on recent run patterns
- Cost summary: per-agent and per-workspace totals with trend indicators
- Summary endpoint integration: `GET /channels/:id/summary?days=N` for efficient pre-aggregated data

**Success Criteria:**
1. Fleet overview shows all workspaces as cards with correct agent counts and health indicators
2. Clicking a workspace card shows its agents with run success rates matching the relay data
3. Clicking an agent shows the run history table with correct timestamps, durations, and statuses
4. Date range selector filters all views correctly — switching from "7 days" to "24h" updates all numbers
5. Cost data displays per-agent when available (Paperclip, Claude Code), absent gracefully when not

**Research Flag:** Standard patterns — skip research. React components in webview, existing dashboard pattern.

---

### Phase 17: Proactive Alerts

**Goal:** The extension proactively notifies the user about agent problems — stale agents, high failure rates — so they don't have to check manually.

**Depends on:** Phase 16 (fleet dashboard provides context for alerts)

**Requirements:** ALRT-01, ALRT-02, ALRT-03, ALRT-04, ALRT-05

**Key Deliverables:**
- Alert engine in extension: evaluates relay summary data against configured thresholds
- Stale agent detection: alert when agent hasn't reported within 2x expected schedule interval
- Failure rate threshold: alert on N consecutive failures (default: 3)
- VS Code notification delivery: batch unread alerts, show count in status bar badge
- Alert configuration per workspace: enable/disable, thresholds, quiet hours (stored in workspace config)
- Relay-side alert state: relay stores alert flags; extension fetches unread alerts on connect
- Alert dismissal: marking alerts as read syncs back to relay

**Success Criteria:**
1. An agent that misses 2x its schedule triggers a stale alert in VS Code
2. Three consecutive agent failures trigger a failure alert
3. Alerts appear as VS Code notifications on editor open with correct agent/workspace context
4. Alert configuration changes in settings persist and affect threshold evaluation
5. Dismissed alerts don't reappear on next editor open

**Research Flag:** Standard patterns — skip research. VS Code notification API, simple threshold logic.

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Extension Scaffold, Registry, Sidebar | 3/3 | Complete | 2026-04-16 |
| 2. Claude Code Adapter + Dashboard | 4/4 | Complete | 2026-04-16 |
| 3. Agent Schematic (Live Topology) | 3/3 | Complete | 2026-04-18 |
| 4. Chat Interface + Terminal | 2/2 | Complete | 2026-04-18 |
| 5. Workspace Scaffolding + OpenClaw Adapter | 3/3 | Complete | 2026-04-19 |
| 6. Pre-Work — Type Consolidation + Monorepo | 2/2 | Complete | 2026-04-19 |
| 7. Relay API | 2/2 | Complete | 2026-04-19 |
| 8. Agent CLI + Daily Briefing Reports | 3/3 | Complete | 2026-04-19 |
| 9. RemoteAdapter + Remote Workspace Management | 2/2 | Complete | 2026-04-19 |
| 10. Report Timeline UI + Async Chat | 2/2 | Complete | 2026-04-21 |
| 11. Multi-Agent Model + Relay Extensions | 2/2 | Complete    | 2026-04-23 |
| 12. Collector Daemon + Easy Setup | 1/2 | In Progress|  |
| 13. Paperclip Adapter | 0/2 | Complete    | 2026-04-23 |
| 14. Claude Desktop + Claude Code Cron Adapters | 0/? | Not started | - |
| 15. OpenClaw Remote Adapter | 0/? | Not started | - |
| 16. Fleet Dashboard + Historical Reporting UI | 0/? | Not started | - |
| 17. Proactive Alerts | 0/? | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Complete |
| FOUN-02 | Phase 1 | Complete |
| FOUN-03 | Phase 1 | Complete |
| FOUN-04 | Phase 1 | Complete |
| WKSP-01 | Phase 1 | Complete |
| WKSP-03 | Phase 1 | Complete |
| WKSP-04 | Phase 1 | Complete |
| WKSP-05 | Phase 1 | Complete |
| SIDE-01 | Phase 1 | Complete |
| SIDE-02 | Phase 1 | Complete |
| SIDE-03 | Phase 1 | Complete |
| SIDE-04 | Phase 1 | Complete |
| SIDE-05 | Phase 1 | Complete |
| DASH-01 | Phase 2 | Complete |
| DASH-02 | Phase 2 | Complete |
| DASH-03 | Phase 2 | Complete |
| DASH-04 | Phase 2 | Complete |
| DASH-05 | Phase 2 | Complete |
| CTRL-01 | Phase 2 | Complete |
| CTRL-02 | Phase 2 | Complete |
| CTRL-03 | Phase 2 | Complete |
| CTRL-04 | Phase 2 | Complete |
| CCAD-01 | Phase 2 | Complete |
| CCAD-02 | Phase 2 | Complete |
| CCAD-03 | Phase 2 | Complete |
| CCAD-04 | Phase 2 | Complete |
| CCAD-05 | Phase 2 | Complete |
| CCAD-06 | Phase 2 | Complete |
| NOTF-01 | Phase 2 | Complete |
| NOTF-02 | Phase 2 | Complete |
| NOTF-03 | Phase 2 | Complete |
| SCHM-01 | Phase 3 | Complete |
| SCHM-02 | Phase 3 | Complete |
| SCHM-03 | Phase 3 | Complete |
| SCHM-04 | Phase 3 | Complete |
| SCHM-05 | Phase 3 | Complete |
| SCHM-06 | Phase 3 | Complete |
| CHAT-01 | Phase 4 | Complete |
| CHAT-02 | Phase 4 | Complete |
| CHAT-03 | Phase 4 | Complete |
| CHAT-04 | Phase 4 | Complete |
| WKSP-02 | Phase 5 | Complete |
| PRWK-01 | Phase 6 | Complete |
| PRWK-02 | Phase 6 | Complete |
| PRWK-03 | Phase 6 | Complete |
| PRWK-04 | Phase 6 | Complete |
| PRWK-05 | Phase 6 | Complete |
| RLAY-01 | Phase 7 | Complete |
| RLAY-02 | Phase 7 | Complete |
| RLAY-03 | Phase 7 | Complete |
| RLAY-04 | Phase 7 | Complete |
| RLAY-05 | Phase 7 | Complete |
| RLAY-06 | Phase 7 | Complete |
| RLAY-07 | Phase 7 | Complete |
| RLAY-08 | Phase 7 | Complete |
| RLAY-09 | Phase 7 | Complete |
| RLAY-10 | Phase 7 | Complete |
| RLAY-11 | Phase 7 | Complete |
| RLAY-12 | Phase 7 | Complete |
| RLAY-13 | Phase 7 | Complete |
| RLAY-14 | Phase 7 | Complete |
| ACLI-01 | Phase 8 | Complete |
| ACLI-02 | Phase 8 | Complete |
| ACLI-03 | Phase 8 | Complete |
| ACLI-04 | Phase 8 | Complete |
| ACLI-05 | Phase 8 | Complete |
| ACLI-06 | Phase 8 | Complete |
| ACLI-07 | Phase 8 | Complete |
| ACLI-08 | Phase 8 | Complete |
| ACLI-09 | Phase 8 | Complete |
| ACLI-10 | Phase 8 | Complete |
| ACLI-11 | Phase 8 | Complete |
| BRFG-01 | Phase 8 | Complete |
| BRFG-02 | Phase 8 | Complete |
| BRFG-03 | Phase 8 | Complete |
| BRFG-04 | Phase 8 | Complete |
| BRFG-05 | Phase 10 | Complete |
| RLPH-01 | Phase 9 | Complete |
| RLPH-02 | Phase 9 | Complete |
| RLPH-03 | Phase 9 | Complete |
| RLPH-04 | Phase 9 | Complete |
| RLPH-05 | Phase 9 | Complete |
| RWKS-01 | Phase 9 | Complete |
| RWKS-02 | Phase 9 | Complete |
| RWKS-03 | Phase 9 | Complete |
| RWKS-04 | Phase 9 | Complete |
| RWKS-05 | Phase 9 | Complete |
| RWKS-06 | Phase 9 | Complete |
| RWKS-07 | Phase 9 | Complete |
| RWKS-08 | Phase 9 | Complete |
| RWKS-09 | Phase 9 | Complete |
| ACHAT-01 | Phase 10 | Complete |
| ACHAT-02 | Phase 10 | Complete |
| ACHAT-03 | Phase 10 | Complete |
| ACHAT-04 | Phase 10 | Complete |
| ACHAT-05 | Phase 10 | Complete |
| TMLN-01 | Phase 10 | Complete |
| TMLN-02 | Phase 10 | Complete |
| TMLN-03 | Phase 10 | Complete |
| TMLN-04 | Phase 10 | Complete |
| TMLN-05 | Phase 10 | Complete |
| TMLN-06 | Phase 10 | Complete |
| TMLN-07 | Phase 10 | Complete |
| TMLN-08 | Phase 10 | Complete |
| MAWM-01 | Phase 11 | Planned |
| MAWM-02 | Phase 11 | Planned |
| MAWM-03 | Phase 11 | Planned |
| MAWM-04 | Phase 11 | Planned |
| MAWM-05 | Phase 11 | Planned |
| RLYX-01 | Phase 11 | Planned |
| RLYX-02 | Phase 11 | Planned |
| RLYX-03 | Phase 11 | Planned |
| RLYX-04 | Phase 11 | Planned |
| COLL-01 | Phase 12 | Planned |
| COLL-02 | Phase 12 | Planned |
| COLL-03 | Phase 12 | Planned |
| COLL-04 | Phase 12 | Planned |
| COLL-05 | Phase 12 | Planned |
| COLL-06 | Phase 12 | Planned |
| PCLP-01 | Phase 13 | Planned |
| PCLP-02 | Phase 13 | Planned |
| PCLP-03 | Phase 13 | Planned |
| PCLP-04 | Phase 13 | Planned |
| PCLP-05 | Phase 13 | Planned |
| PCLP-06 | Phase 13 | Planned |
| CDSK-01 | Phase 14 | Planned |
| CDSK-02 | Phase 14 | Planned |
| CDSK-03 | Phase 14 | Planned |
| CDSK-04 | Phase 14 | Planned |
| CDSK-05 | Phase 14 | Planned |
| CDSK-06 | Phase 14 | Planned |
| CCCR-01 | Phase 14 | Planned |
| CCCR-02 | Phase 14 | Planned |
| CCCR-03 | Phase 14 | Planned |
| CCCR-04 | Phase 14 | Planned |
| CCCR-05 | Phase 14 | Planned |
| OCLW-01 | Phase 15 | Planned |
| OCLW-02 | Phase 15 | Planned |
| OCLW-03 | Phase 15 | Planned |
| OCLW-04 | Phase 15 | Planned |
| FDSH-01 | Phase 16 | Planned |
| FDSH-02 | Phase 16 | Planned |
| FDSH-03 | Phase 16 | Planned |
| FDSH-04 | Phase 16 | Planned |
| FDSH-05 | Phase 16 | Planned |
| FDSH-06 | Phase 16 | Planned |
| ALRT-01 | Phase 17 | Planned |
| ALRT-02 | Phase 17 | Planned |
| ALRT-03 | Phase 17 | Planned |
| ALRT-04 | Phase 17 | Planned |
| ALRT-05 | Phase 17 | Planned |

**v1.0 Coverage: 41/41 requirements mapped. All complete.**

**v2.0 Coverage: 57/57 requirements mapped. All complete.**

**v3.0 Coverage: 47/47 requirements mapped. No orphans.**

---

## Key Architectural Constraints (for plan-phase reference)

These decisions are locked. Plan-phase should not re-litigate them.

### Milestone 1 (v1.0) — Established Constraints

| Decision | Rationale |
|----------|-----------|
| `sql.js` for SQLite, NOT `better-sqlite3` | `better-sqlite3` requires native C++ compiled against VSCode's specific Electron version; `sql.js` uses WebAssembly, zero compilation issues |
| VSCode native `Pseudoterminal` for v1 terminal, NOT `node-pty` | `node-pty` requires native binaries per platform (win32/darwin/linux, arm64/x64); complex VSIX packaging; defer to v2 |
| D3.js for live topology, NOT Mermaid | Mermaid cannot dynamically add/remove nodes without full DOM re-render + flicker; click events have known bugs; CSP concerns in webview context |
| `WebviewView` for sidebar, NOT `TreeView` | Custom health indicators (badges, sparklines) exceed `TreeView` rendering capability |
| `acquireVsCodeApi()` called once per webview, stored in module scope | Throws on second call — the most common webview bug |
| `retainContextWhenHidden: true` on terminal panel ONLY | Each retained panel holds 80-150MB browser context; use `getState/setState` for all data panels |
| Absolute paths in workspace registry | VSCode opens in different working directories; relative paths silently resolve incorrectly |
| `RelativePattern` with absolute base for all file watchers | String glob patterns only watch inside the current VSCode workspace folder; agent dirs are typically outside it |
| `@vscode/webview-ui-toolkit` — DO NOT USE | Officially deprecated January 2025; use VSCode Elements or plain CSS with VSCode CSS variables |

### Milestone 2 (v2.0) — New Constraints

| Decision | Rationale |
|----------|-----------|
| Relay is a dumb document store — no server-side validation of report schema | Keeps relay schema-agnostic; all report structure lives client-side; relay can be self-hosted without schema knowledge |
| No WebSocket or SSE on relay | Vercel serverless cannot hold persistent connections; async polling is sufficient for v2.0 async messaging use case |
| No inbound HTTP server on agent machines | Breaks the outbound-only networking model; requires firewall rules and open ports |
| `@libsql/client ./http` subpath, NOT top-level import | Vercel Node.js runtime compatibility; WebSocket subpath not suitable for serverless context |
| Turso client initialized per-request, NOT at module scope | Prevents stale connection on Vercel warm starts; avoids sporadic 500s from broken WebSocket connections |
| Default 5-minute poll interval in CLI (configurable, no hard floor) | Vercel Hobby plan: 100K invocations/month; 10 agents at 1-min = 432K/month (4.3x cap); self-hosted relay users may want 30s for near-real-time; jitter added per cycle |
| `crypto.timingSafeEqual` for ALL token comparisons — non-negotiable | String equality leaks timing information; timing attack allows byte-by-byte token enumeration |
| Auth token NEVER in workspaces.json | VSCode SecretStore for extension; 0600 JSON credential file for CLI; settings.json is readable by other extensions |
| Paginated report list API in v2.0.0 contract from day one | Vercel 4.5MB payload limit; retrofitting pagination after deployment breaks all deployed agents |
| `X-Agent-Version` header on all CLI requests from day one | Allows relay to reject incompatible old CLI versions with `426 Upgrade Required`; retrofitting breaks deployed agents |
| Remote report data cached in-memory in RemoteAdapter, NOT in local SQLite | Avoids schema coupling between local event store and relay report format; offline viewing deferred to v2.1 |
| ReportPanel is a separate WebviewPanel from DashboardPanel | Different purposes: historical report timeline vs. live event stream; both can be open side-by-side |

---

*Roadmap created: 2026-04-16*
*Milestone 2 (v2.0) phases added: 2026-04-19*
*Last updated: 2026-04-19 — v2.0 roadmap complete (Phases 6–10)*
