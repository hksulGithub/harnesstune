# Requirements: HarnessTune

**Defined:** 2026-04-16
**Updated:** 2026-04-19 (v2.0 requirements added)
**Core Value:** Engineers running multiple agent systems can see and control all their agents from one place inside VSCode.

## v1.0 Requirements (Complete)

### Extension Foundation (FOUN)

- [x] **FOUN-01**: Extension activates in VSCode and registers commands with `HarnessTune:` prefix
- [x] **FOUN-02**: Extension uses esbuild dual-target build (CJS extension host + ESM webview bundles)
- [x] **FOUN-03**: Extension stores workspace registry as JSON at `globalStorageUri`
- [x] **FOUN-04**: Extension stores API keys via `context.secrets`, never in globalState

### Workspace Management (WKSP)

- [x] **WKSP-01**: User can create a new workspace by connecting to an existing agent directory
- [x] **WKSP-02**: User can create a new workspace from a scaffold template
- [x] **WKSP-03**: User can remove a workspace from the registry
- [x] **WKSP-04**: Workspace registry persists absolute paths and survives VSCode restarts
- [x] **WKSP-05**: File watcher pipeline monitors agent directories using RelativePattern with absolute base paths

### Sidebar (SIDE)

- [x] **SIDE-01**: Sidebar shows workspace list with status indicators (running/idle/warning/error)
- [x] **SIDE-02**: Status indicators use color + shape (never color alone) for accessibility
- [x] **SIDE-03**: Clicking a workspace opens its workspace view in the editor area
- [x] **SIDE-04**: Sidebar is a WebviewView with React, registered via `registerWebviewViewProvider`
- [x] **SIDE-05**: Status bar item shows running agent count + error badge

### Dashboard (DASH)

- [x] **DASH-01**: Main dashboard WebviewPanel shows aggregate health across all workspaces
- [x] **DASH-02**: Per-workspace mini dashboard shows summary cards (total agents, running, errors, cost)
- [x] **DASH-03**: Agent detail panel shows: role, model, status, current task, recent actions, config excerpt
- [x] **DASH-04**: Dashboard panels persist across VSCode restarts via WebviewPanelSerializer
- [x] **DASH-05**: Dashboard uses typed postMessage contracts (HostToWebviewMessage / WebviewToHostMessage)

### Agent Controls (CTRL)

- [x] **CTRL-01**: User can pause a running agent from the dashboard
- [x] **CTRL-02**: User can resume a paused agent
- [x] **CTRL-03**: User can stop/cancel a running agent
- [x] **CTRL-04**: Controls are accessible via both UI buttons and Command Palette

### Agent Schematic (SCHM)

- [x] **SCHM-01**: Interactive topology graph renders in a WebviewPanel using D3.js or React Flow
- [x] **SCHM-02**: Graph reconstructs agent hierarchy from SubagentStart/SubagentStop events
- [x] **SCHM-03**: Clicking a node shows agent info (role, status, config, instructions, recent actions)
- [x] **SCHM-04**: Graph supports zoom, pan, and "fit to view"
- [x] **SCHM-05**: Edges animate to show message-in-flight between agents
- [x] **SCHM-06**: Graph uses hierarchical layout (dagre/d3-dag) by default

### Chat Interface (CHAT)

- [x] **CHAT-01**: Embedded terminal per workspace using VSCode native Pseudoterminal API
- [x] **CHAT-02**: Terminal routes to the workspace's configured LLM backend (Claude Code first)
- [x] **CHAT-03**: Terminal panel retains context when hidden (retainContextWhenHidden: true)
- [x] **CHAT-04**: User can send instructions and receive responses in the terminal

### Claude Code Adapter (CCAD)

- [x] **CCAD-01**: Local HTTP server in extension host receives Claude Code hook POSTs
- [x] **CCAD-02**: Adapter auto-injects hook config into `~/.claude/settings.json` on connect
- [x] **CCAD-03**: Adapter auto-removes hook config on disconnect
- [x] **CCAD-04**: Adapter normalizes Claude Code events to shared AgentEvent schema (OTel-aligned)
- [x] **CCAD-05**: Token usage, cost, and timing data are captured per agent session
- [x] **CCAD-06**: Agent events stored in sql.js SQLite database at globalStorageUri

### Notifications (NOTF)

- [x] **NOTF-01**: Agent errors trigger VSCode toast notifications
- [x] **NOTF-02**: Informational events update status bar only (no toasts)
- [x] **NOTF-03**: Status bar error badge increments on new errors

---

## v2.0 Requirements — Remote Agent Management

### Pre-Work: Type Consolidation (PRWK)

- [x] **PRWK-01**: `BackendType` consolidated to a single canonical definition with `'remote'` added
- [x] **PRWK-02**: `WorkspaceRecord` gains `mode: 'local' | 'remote'` discriminant for TypeScript narrowing
- [x] **PRWK-03**: Workspace registry migrated to version 2 schema (backward-compatible with v1 data)
- [ ] **PRWK-04**: Monorepo structure created: `packages/harnesstune-relay`, `packages/harnesstune-agent`, root extension
- [ ] **PRWK-05**: TypeScript project references configured for cross-package type sharing

### Relay API (RLAY)

- [ ] **RLAY-01**: REST API deployed on Vercel with Turso (SQLite) persistence — acts as a dumb document store / mailbox
- [ ] **RLAY-02**: Generic channel-based data model (channels, tokens, reports, messages tables) — relay is schema-agnostic
- [ ] **RLAY-03**: Token-based auth — per-agent Bearer tokens, stored as SHA-256 hash in Turso, compared with `crypto.timingSafeEqual`
- [ ] **RLAY-04**: `POST /channels/:id/reports` — agents upload structured report JSON
- [ ] **RLAY-05**: `GET /channels/:id/reports` — command center reads reports with `?since=` cursor pagination
- [ ] **RLAY-06**: `POST /channels/:id/messages` — command center posts feedback / instructions to agent
- [ ] **RLAY-07**: `GET /channels/:id/messages` — agents poll for new messages with `?since=` cursor
- [ ] **RLAY-08**: Agent registration endpoint returns token once — token shown only at registration time
- [ ] **RLAY-09**: `GET /health` endpoint returns 200 + relay version for connection verification
- [ ] **RLAY-10**: Paginated report list API (metadata-only on list, full body on `/reports/:id`) to stay under 4.5MB Vercel payload limit
- [ ] **RLAY-11**: `X-Agent-Version` header support — reject agents below minimum compatible version
- [ ] **RLAY-12**: Header sanitization middleware — `Authorization` header never logged as plaintext
- [ ] **RLAY-13**: One-command Vercel deployment (`vercel deploy` from repo)
- [ ] **RLAY-14**: Per-token rate limiting — 60 requests/minute per Bearer token; returns `429 Too Many Requests` with `Retry-After` header

### Agent CLI Sidecar (ACLI)

- [ ] **ACLI-01**: `npx harnesstune-agent` zero-install entry point — Node.js 20+ as only prerequisite
- [ ] **ACLI-02**: Interactive registration flow — prompts for relay URL, registers with relay, stores token in `.harnesstune/config.json`
- [ ] **ACLI-03**: Structured report upload — reads report JSON from stdin or watched file path, POSTs to relay
- [x] **ACLI-04**: Message polling — short-poll relay on configurable interval (default 60s) with exponential backoff on errors
- [x] **ACLI-05**: Instruction routing — routes received messages to local agent system (Claude Code via `claude` CLI; stub acceptable for other backends)
- [x] **ACLI-06**: Status heartbeat — uploads heartbeat every 5 minutes; extension marks workspace stale after 15 minutes without heartbeat
- [x] **ACLI-07**: Graceful shutdown — SIGTERM/SIGINT/SIGHUP handlers; uploads "disconnected" status before exit
- [ ] **ACLI-08**: PID file management — prevents orphaned daemon processes; `stop` subcommand for clean shutdown
- [ ] **ACLI-09**: Config file management — `.harnesstune/config.json` with relay URL, agent ID, token, poll interval
- [ ] **ACLI-10**: `--dry-run` flag — validates setup without uploading data to relay
- [x] **ACLI-11**: Bounded local retry queue — caps at 48 reports, disk-persisted, retries on relay recovery

### Daily Briefing Reports (BRFG)

- [ ] **BRFG-01**: Structured briefing format — goals, current progress, blockers, next steps, metrics snapshot fields
- [x] **BRFG-02**: Configurable report schedule — cron expression or simple interval in CLI config (default: daily)
- [ ] **BRFG-03**: Each report has ISO 8601 timestamp and UUID report ID for ordering and deduplication
- [ ] **BRFG-04**: Metrics snapshot includes tokens used, tasks completed, and errors encountered (numeric, graphable)
- [ ] **BRFG-05**: Reports render in extension as a chronological timeline per workspace (see TMLN category)

### Ralph Loop Progress Reports (RLPH)

- [ ] **RLPH-01**: Iteration report format — iteration number, baseline metrics, current metrics, delta, what changed, cumulative improvement
- [ ] **RLPH-02**: Loop ID (UUID) ties all iteration reports for a single loop together
- [ ] **RLPH-03**: Generic named-metric design — `{ "metric_name": number }` map; different loops measure different things
- [ ] **RLPH-04**: Delta computed client-side (extension) or pre-computed by CLI — both approaches supported
- [ ] **RLPH-05**: Reports render in extension with dedicated ralph loop card component (see TMLN category)

### Async Chat / Feedback (ACHAT)

- [ ] **ACHAT-01**: Engineer can post a message to any remote agent from the extension via relay
- [ ] **ACHAT-02**: Agent responses (posted via CLI) are visible in the extension conversation thread
- [ ] **ACHAT-03**: Messages are scoped per workspace — channel ID = workspace ID, relay enforces isolation via token
- [ ] **ACHAT-04**: Messages carry timestamp and read status (`delivered_at` when agent polls, `replied_at` when agent responds)
- [ ] **ACHAT-05**: Conversation history — GET returns last 50 messages; extension renders as threaded list

### Remote Workspace Management (RWKS)

- [ ] **RWKS-01**: "Add Remote Workspace" command — QuickInput flow: relay URL → agent token → test connection → save to registry
- [ ] **RWKS-02**: Remote workspaces appear in sidebar alongside local ones — same list, not a separate section, with small "remote" icon
- [ ] **RWKS-03**: Status indicators for remote workspaces — running/idle/error/stale derived from latest report data
- [ ] **RWKS-04**: Click remote workspace → opens report timeline panel
- [ ] **RWKS-05**: Right-click → "Message Agent" opens async chat for that workspace
- [ ] **RWKS-06**: Right-click → "Configure" allows updating relay URL, poll interval, token via QuickInput
- [ ] **RWKS-07**: Right-click → "Remove" disconnects remote workspace from registry (does not delete relay data)
- [ ] **RWKS-08**: Connection error handling — distinguishes relay unreachable (network badge), token invalid (401 + re-configure prompt), stale data (dim + timestamp)
- [ ] **RWKS-09**: Agent tokens stored in VSCode SecretStore via QuickInput (password mode) — never in settings.json

### Report Timeline UI (TMLN)

- [ ] **TMLN-01**: `ReportPanel` WebviewPanel with chronological feed per workspace (newest first)
- [ ] **TMLN-02**: Briefing report card renders goals/progress/blockers/next steps/metrics with collapsible sections
- [ ] **TMLN-03**: Ralph loop report card renders iteration/baseline/current/delta/what-changed with +/- color coding
- [ ] **TMLN-04**: Convergence chart — D3 line chart in webview: x-axis = iteration, y-axis = metric value, one line per metric
- [ ] **TMLN-05**: Report type filtering — tabs or dropdown to filter briefings / ralph reports / all
- [ ] **TMLN-06**: Interleaved chat messages — chat bubbles and report cards in the same chronological feed
- [ ] **TMLN-07**: "Reply" button on report cards — opens message compose area pre-filled with `in_reply_to_report_id`
- [ ] **TMLN-08**: Paginated load — last 20 reports on open, "Load more" button for history

---

## Out of Scope (v2.0)

| Feature | Reason |
|---------|--------|
| Real-time streaming (WebSocket/SSE) | Async/polling for v2.0; live terminal streaming is v3 |
| Agent orchestration | v2.0 is observe + communicate; automated coordination is future |
| Multi-user / team features | Single user for now; shared relay, permissions, audit log are v3+ |
| Mobile app | VSCode only; mobile companion for reading reports is future |
| End-to-end encryption | Relay sees plaintext; E2E encryption is v3 feature flag |
| Building agent frameworks | Integrates with existing ones only |
| Relay-side message schema validation | Keep relay as dumb mailbox; validate client-side |
| Inbound HTTP server on remote machines | Breaks outbound-only networking model |
| Auto-synthesize briefing from logs | Agent-generated briefings simpler for v2.0; log synthesis is v2.1 |
| Loop comparison (A vs B) | High complexity, low urgency for v2.0 launch |
| Framework auto-detection in CLI | Reduces manual config but medium complexity; defer to v2.1 |
| Multi-workspace morning summary rollup | Useful with 5+ workspaces; single-workspace must work first |
| Self-host LAN relay script | Docker Compose / npx bootstrap for air-gapped; defer to v2.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 through FOUN-04 | Phase 1 | Complete |
| WKSP-01 through WKSP-05 | Phase 1/5 | Complete |
| SIDE-01 through SIDE-05 | Phase 1 | Complete |
| DASH-01 through DASH-05 | Phase 2 | Complete |
| CTRL-01 through CTRL-04 | Phase 2 | Complete |
| SCHM-01 through SCHM-06 | Phase 3 | Complete |
| CHAT-01 through CHAT-04 | Phase 4 | Complete |
| CCAD-01 through CCAD-06 | Phase 2 | Complete |
| NOTF-01 through NOTF-03 | Phase 2 | Complete |
| PRWK-01 | Phase 6 | Complete |
| PRWK-02 | Phase 6 | Complete |
| PRWK-03 | Phase 6 | Complete |
| PRWK-04 | Phase 6 | Planned |
| PRWK-05 | Phase 6 | Planned |
| RLAY-01 through RLAY-14 | Phase 7 | Planned |
| ACLI-01 through ACLI-11 | Phase 8 | Planned |
| BRFG-01 through BRFG-05 | Phase 8–9 | Planned |
| RLPH-01 through RLPH-05 | Phase 9–10 | Planned |
| ACHAT-01 through ACHAT-05 | Phase 10 | Planned |
| RWKS-01 through RWKS-09 | Phase 9 | Planned |
| TMLN-01 through TMLN-08 | Phase 10 | Planned |

**Coverage:**
- v1.0 requirements: 40 total (all complete)
- v2.0 requirements: 57 total
- Unmapped: 0 (phase assignments are provisional — roadmap will finalize)

---
*Requirements defined: 2026-04-16*
*v2.0 requirements added: 2026-04-19*
