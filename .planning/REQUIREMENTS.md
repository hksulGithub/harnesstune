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
- [x] **PRWK-04**: Monorepo structure created: `packages/harnesstune-relay`, `packages/harnesstune-agent`, root extension
- [x] **PRWK-05**: TypeScript project references configured for cross-package type sharing

### Relay API (RLAY)

- [x] **RLAY-01**: REST API deployed on Vercel with Turso (SQLite) persistence — acts as a dumb document store / mailbox
- [x] **RLAY-02**: Generic channel-based data model (channels, tokens, reports, messages tables) — relay is schema-agnostic
- [x] **RLAY-03**: Token-based auth — per-agent Bearer tokens, stored as SHA-256 hash in Turso, compared with `crypto.timingSafeEqual`
- [x] **RLAY-04**: `POST /channels/:id/reports` — agents upload structured report JSON
- [x] **RLAY-05**: `GET /channels/:id/reports` — command center reads reports with `?since=` cursor pagination
- [x] **RLAY-06**: `POST /channels/:id/messages` — command center posts feedback / instructions to agent
- [x] **RLAY-07**: `GET /channels/:id/messages` — agents poll for new messages with `?since=` cursor
- [x] **RLAY-08**: Agent registration endpoint returns token once — token shown only at registration time
- [x] **RLAY-09**: `GET /health` endpoint returns 200 + relay version for connection verification
- [x] **RLAY-10**: Paginated report list API (metadata-only on list, full body on `/reports/:id`) to stay under 4.5MB Vercel payload limit
- [x] **RLAY-11**: `X-Agent-Version` header support — reject agents below minimum compatible version
- [x] **RLAY-12**: Header sanitization middleware — `Authorization` header never logged as plaintext
- [x] **RLAY-13**: One-command Vercel deployment (`vercel deploy` from repo)
- [x] **RLAY-14**: Per-token rate limiting — 60 requests/minute per Bearer token; returns `429 Too Many Requests` with `Retry-After` header

### Agent CLI Sidecar (ACLI)

- [x] **ACLI-01**: `npx harnesstune-agent` zero-install entry point — Node.js 20+ as only prerequisite
- [x] **ACLI-02**: Interactive registration flow — prompts for relay URL, registers with relay, stores token in `.harnesstune/config.json`
- [x] **ACLI-03**: Structured report upload — reads report JSON from stdin or watched file path, POSTs to relay
- [x] **ACLI-04**: Message polling — short-poll relay on configurable interval (default 60s) with exponential backoff on errors
- [x] **ACLI-05**: Instruction routing — routes received messages to local agent system (Claude Code via `claude` CLI; stub acceptable for other backends)
- [x] **ACLI-06**: Status heartbeat — uploads heartbeat every 5 minutes; extension marks workspace stale after 15 minutes without heartbeat
- [x] **ACLI-07**: Graceful shutdown — SIGTERM/SIGINT/SIGHUP handlers; uploads "disconnected" status before exit
- [x] **ACLI-08**: PID file management — prevents orphaned daemon processes; `stop` subcommand for clean shutdown
- [x] **ACLI-09**: Config file management — `.harnesstune/config.json` with relay URL, agent ID, token, poll interval
- [x] **ACLI-10**: `--dry-run` flag — validates setup without uploading data to relay
- [x] **ACLI-11**: Bounded local retry queue — caps at 48 reports, disk-persisted, retries on relay recovery

### Daily Briefing Reports (BRFG)

- [x] **BRFG-01**: Structured briefing format — goals, current progress, blockers, next steps, metrics snapshot fields
- [x] **BRFG-02**: Configurable report schedule — cron expression or simple interval in CLI config (default: daily)
- [x] **BRFG-03**: Each report has ISO 8601 timestamp and UUID report ID for ordering and deduplication
- [x] **BRFG-04**: Metrics snapshot includes tokens used, tasks completed, and errors encountered (numeric, graphable)
- [x] **BRFG-05**: Reports render in extension as a chronological timeline per workspace (see TMLN category)

### Ralph Loop Progress Reports (RLPH)

- [x] **RLPH-01**: Iteration report format — iteration number, baseline metrics, current metrics, delta, what changed, cumulative improvement
- [x] **RLPH-02**: Loop ID (UUID) ties all iteration reports for a single loop together
- [x] **RLPH-03**: Generic named-metric design — `{ "metric_name": number }` map; different loops measure different things
- [x] **RLPH-04**: Delta computed client-side (extension) or pre-computed by CLI — both approaches supported
- [x] **RLPH-05**: Reports render in extension with dedicated ralph loop card component (see TMLN category)

### Async Chat / Feedback (ACHAT)

- [x] **ACHAT-01**: Engineer can post a message to any remote agent from the extension via relay
- [x] **ACHAT-02**: Agent responses (posted via CLI) are visible in the extension conversation thread
- [x] **ACHAT-03**: Messages are scoped per workspace — channel ID = workspace ID, relay enforces isolation via token
- [x] **ACHAT-04**: Messages carry timestamp and read status (`delivered_at` when agent polls, `replied_at` when agent responds)
- [x] **ACHAT-05**: Conversation history — GET returns last 50 messages; extension renders as threaded list

### Remote Workspace Management (RWKS)

- [x] **RWKS-01**: "Add Remote Workspace" command — QuickInput flow: relay URL → agent token → test connection → save to registry
- [x] **RWKS-02**: Remote workspaces appear in sidebar alongside local ones — same list, not a separate section, with small "remote" icon
- [x] **RWKS-03**: Status indicators for remote workspaces — running/idle/error/stale derived from latest report data
- [x] **RWKS-04**: Click remote workspace → opens report timeline panel
- [x] **RWKS-05**: Right-click → "Message Agent" opens async chat for that workspace
- [x] **RWKS-06**: Right-click → "Configure" allows updating relay URL, poll interval, token via QuickInput
- [x] **RWKS-07**: Right-click → "Remove" disconnects remote workspace from registry (does not delete relay data)
- [x] **RWKS-08**: Connection error handling — distinguishes relay unreachable (network badge), token invalid (401 + re-configure prompt), stale data (dim + timestamp)
- [x] **RWKS-09**: Agent tokens stored in VSCode SecretStore via QuickInput (password mode) — never in settings.json

### Report Timeline UI (TMLN)

- [x] **TMLN-01**: `ReportPanel` WebviewPanel with chronological feed per workspace (newest first)
- [x] **TMLN-02**: Briefing report card renders goals/progress/blockers/next steps/metrics with collapsible sections
- [x] **TMLN-03**: Ralph loop report card renders iteration/baseline/current/delta/what-changed with +/- color coding
- [x] **TMLN-04**: Convergence chart — D3 line chart in webview: x-axis = iteration, y-axis = metric value, one line per metric
- [x] **TMLN-05**: Report type filtering — tabs or dropdown to filter briefings / ralph reports / all
- [x] **TMLN-06**: Interleaved chat messages — chat bubbles and report cards in the same chronological feed
- [x] **TMLN-07**: "Reply" button on report cards — opens message compose area pre-filled with `in_reply_to_report_id`
- [x] **TMLN-08**: Paginated load — last 20 reports on open, "Load more" button for history

---

---

## v3.0 Requirements — Multi-Platform Agent Fleet Management

### Multi-Agent Workspace Model (MAWM)

- [x] **MAWM-01**: Workspace represents a platform instance on a specific machine (e.g., "Paperclip on Mac Mini"), not a single agent
- [x] **MAWM-02**: Each workspace contains multiple agents — an agent = one cron job, scheduled task, or heartbeat-driven process
- [x] **MAWM-03**: `WorkspaceRecord` extended with `agents: AgentIdentity[]` — each agent has `id`, `name`, `schedule` (cron expression or description), `platform`, `lastRunAt`, `status`
- [x] **MAWM-04**: Relay channel model extended — one channel per workspace, reports tagged with `agentId` field for per-agent attribution
- [ ] **MAWM-05**: Agent discovery: collector auto-discovers agents (cron entries, Paperclip API, Claude Desktop `scheduled-tasks.json`) and registers them

### Collector Daemon (COLL)

- [ ] **COLL-01**: Single `harnesstune-collector` process per remote machine replaces per-agent sidecar — manages all platforms on that machine
- [ ] **COLL-02**: `npx harnesstune-collector setup` — guided onboarding: relay URL, token, platform auto-detection (detects installed platforms)
- [ ] **COLL-03**: Platform plugin architecture — collector loads platform-specific modules (Paperclip, Claude Desktop, Claude Code, OpenClaw)
- [ ] **COLL-04**: Collector runs as persistent daemon with heartbeat — reports machine-level health to relay
- [x] **COLL-05**: Per-agent run reporting — after each cron/scheduled task run completes, collector uploads a structured run report to relay with `agentId`, `startedAt`, `finishedAt`, `status` (success/fail/timeout), `durationMs`, `logs` (truncated), `errorSummary`, `tokenUsage`, `costCents`
- [x] **COLL-06**: Historical batch sync — on first connect, collector backfills recent run history (last 7 days) from each platform's local data

### Paperclip Adapter (PCLP)

- [x] **PCLP-01**: Collector plugin polls Paperclip REST API using Board API Key (Bearer token auth)
- [x] **PCLP-02**: Agent discovery via `GET /companies/:companyId/agents` — maps Paperclip agents to HarnessTune agent identities
- [x] **PCLP-03**: Run history via `GET /agents/:id/task-sessions` and `heartbeat_runs` data — maps to standardized run reports
- [x] **PCLP-04**: Cost data via `GET /companies/:companyId/costs/by-agent?from=&to=` — per-agent token and cost breakdowns
- [x] **PCLP-05**: Activity/audit via `GET /companies/:companyId/activity?agentId=` — maps to timeline events
- [x] **PCLP-06**: Setup: collector prompts for Paperclip server URL + Board API Key during `setup`

### Claude Desktop Adapter (CDSK)

- [ ] **CDSK-01**: Collector plugin reads `scheduled-tasks.json` from `~/Library/Application Support/Claude/local-agent-mode-sessions/<orgId>/<userId>/`
- [ ] **CDSK-02**: Agent discovery from `scheduled-tasks.json` entries — maps `id`, `cronExpression`, `enabled`, `model` to HarnessTune agent identity
- [ ] **CDSK-03**: Run history from `local_*.json` session files — correlates sessions to scheduled tasks by matching `initialMessage` against `SKILL.md` prompt + timestamp proximity to `lastScheduledFor`
- [ ] **CDSK-04**: Per-run data extracted from session JSON: `createdAt`, `lastActivityAt` (→ duration), `model`, conversation length, tool call count
- [ ] **CDSK-05**: File watcher on `scheduled-tasks.json` for near-real-time detection of new runs (via `lastRunAt` changes)
- [ ] **CDSK-06**: Setup: collector auto-detects Claude Desktop install path; prompts user to select orgId/userId if multiple exist

### Claude Code Cron Adapter (CCCR)

- [ ] **CCCR-01**: Collector plugin discovers Claude Code cron jobs from `crontab -l` output — filters for entries invoking `claude` CLI
- [ ] **CCCR-02**: Wrapper script (`harnesstune-wrap`) that cron jobs call instead of `claude` directly — captures exit code, duration, stdout/stderr summary, token usage from `claude` output
- [ ] **CCCR-03**: Post-run hook — wrapper uploads run report to collector, which forwards to relay
- [ ] **CCCR-04**: Manual agent registration as fallback — user can register agents by name + cron expression if auto-discovery doesn't fit
- [ ] **CCCR-05**: Setup: collector generates wrapper script and shows user how to update crontab entries

### OpenClaw Adapter (OCLW)

- [ ] **OCLW-01**: Collector plugin tails JSONL session files at `~/.openclaw/agents/<agentId>/sessions/*.jsonl` (same as v1.0 local adapter)
- [ ] **OCLW-02**: Agent discovery from directory listing of `~/.openclaw/agents/` — each subdirectory = one agent
- [ ] **OCLW-03**: Run segmentation — detects session boundaries in JSONL stream, builds per-run reports
- [ ] **OCLW-04**: Setup: collector auto-detects OpenClaw install; prompts for agent directory if non-standard

### Fleet Dashboard (FDSH)

- [ ] **FDSH-01**: Fleet overview in main Dashboard — shows all workspaces as platform cards with agent count, last activity, error rate
- [ ] **FDSH-02**: Drill-down: clicking a workspace card shows its agents as a list with per-agent status, last run, success rate
- [ ] **FDSH-03**: Agent detail view — clicking an agent shows run history table: timestamp, duration, status, cost, expandable log excerpt
- [ ] **FDSH-04**: Multi-day summary — date range selector (last 24h / 3 days / 7 days / 30 days) filters all views
- [ ] **FDSH-05**: Agent health indicators — green (all recent runs succeeded), yellow (some failures), red (consecutive failures or stale), gray (disabled/no data)
- [ ] **FDSH-06**: Cost summary per agent and per workspace — total tokens, total cost, trend (up/down/flat) over selected period

### Proactive Alerts (ALRT)

- [ ] **ALRT-01**: Stale agent detection — alert when an agent hasn't reported a run within 2x its expected schedule interval
- [ ] **ALRT-02**: Failure rate threshold — alert when an agent's failure rate exceeds configurable threshold (default: 3 consecutive failures)
- [ ] **ALRT-03**: Alerts delivered as VS Code notifications on editor open — batch unread alerts, show count badge
- [ ] **ALRT-04**: Alert configuration per workspace — enable/disable, thresholds, quiet hours
- [ ] **ALRT-05**: Optional relay digest — relay stores alert state; extension fetches unread alerts on connect

### Relay Extensions (RLYX)

- [x] **RLYX-01**: Reports endpoint extended with `agentId` field — filter reports by agent within a channel
- [x] **RLYX-02**: `GET /channels/:id/agents` — returns discovered agent list for a channel
- [x] **RLYX-03**: `GET /channels/:id/agents/:agentId/runs` — paginated run history for a specific agent
- [x] **RLYX-04**: `GET /channels/:id/summary?days=N` — pre-aggregated summary (run counts, success rate, cost by agent) for dashboard

## Out of Scope (v3.0)

| Feature | Reason |
|---------|--------|
| Real-time streaming (WebSocket/SSE) | Polling sufficient for "check every few days" usage pattern |
| Agent orchestration / auto-coordination | v3 is observe + report; sending commands to agents is future |
| Multi-user / team features | Single user; shared relay, permissions, audit log are future |
| Mobile app | VSCode only; mobile companion for reading reports is future |
| End-to-end encryption | Relay sees plaintext; E2E encryption is future |
| Building agent frameworks | Integrates with existing ones only |
| Log streaming / live tail | Historical reporting focus; live log streaming is future |
| Custom agent framework adapters | Support Paperclip, Claude, OpenClaw first; generic adapter SDK is future |
| Self-host relay | Vercel + Turso for now; Docker self-host is future |
| Agent-to-agent communication | Agents don't talk to each other through HarnessTune |

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
| PRWK-04 | Phase 6 | Complete |
| PRWK-05 | Phase 6 | Complete |
| RLAY-01 through RLAY-14 | Phase 7 | Complete |
| ACLI-01 through ACLI-11 | Phase 8 | Complete |
| BRFG-01 through BRFG-05 | Phase 8–10 | Complete |
| RLPH-01 through RLPH-05 | Phase 9–10 | Complete |
| ACHAT-01 through ACHAT-05 | Phase 10 | Complete |
| RWKS-01 through RWKS-09 | Phase 9 | Complete |
| TMLN-01 through TMLN-08 | Phase 10 | Complete |
| MAWM-01 through MAWM-05 | Phase 11 | Planned |
| COLL-01 through COLL-06 | Phase 12 | Planned |
| PCLP-01 through PCLP-06 | Phase 13 | Planned |
| CDSK-01 through CDSK-06 | Phase 14 | Planned |
| CCCR-01 through CCCR-05 | Phase 14 | Planned |
| OCLW-01 through OCLW-04 | Phase 15 | Planned |
| FDSH-01 through FDSH-06 | Phase 16 | Planned |
| ALRT-01 through ALRT-05 | Phase 17 | Planned |
| RLYX-01 through RLYX-04 | Phase 11 | Planned |

**Coverage:**
- v1.0 requirements: 40 total (all complete)
- v2.0 requirements: 57 total (all complete)
- v3.0 requirements: 47 total
- Unmapped: 0

---
*Requirements defined: 2026-04-16*
*v2.0 requirements added: 2026-04-19*
