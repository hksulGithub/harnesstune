# Feature Landscape: HarnessTune v2.0 Remote Agent Management

**Domain:** Remote agent command center — relay/mailbox pattern, async agent reporting, CLI sidecar daemon
**Researched:** 2026-04-19
**Scope:** v2.0 NEW features only. v1.0 features (dashboard, schematic, local adapters, chat) are complete and not re-analyzed here.
**Overall confidence:** HIGH for relay/mailbox patterns and auth; MEDIUM for report formats and UI timeline; HIGH for Ralph Loop structure (well-documented upstream)

---

## Summary

The relay/mailbox pattern is a well-established async messaging architecture. The core model — agents and command center each make outbound HTTP requests to a shared intermediary, with no persistent connections or inbound ports — is proven in distributed systems. For agent management specifically, it maps cleanly to the problem: remote agents behind NAT or in air-gapped LANs can reach an HTTPS relay without any firewall exceptions.

The three-component design (relay API, agent CLI sidecar, RemoteAdapter in extension) is the correct decomposition. Each component has a clear boundary: the relay is a dumb document store, all semantic structure lives in the clients. This keeps the relay simple and self-hostable.

Daily briefing reports and Ralph loop progress reports are structured report types with well-understood fields. The briefing format (goals / progress / blockers / next steps / metrics) maps directly to async team standup conventions. The Ralph loop format (iteration / baseline / current / delta / what changed / cumulative) maps to the Ralph Wiggum Loop pattern, which has an active open-source ecosystem (vercel-labs/ralph-loop-agent, PageAI-Pro/ralph-loop, snarktank/ralph). Delta tracking with convergence visualization is the key differentiator — no existing tool in the agent management space renders iteration-over-iteration improvement as a chart.

Async chat through a relay is table stakes for any remote agent management tool. The bidirectional design (command center posts messages → relay holds → agent polls → agent responds → relay holds → command center reads) is the standard async request-reply pattern with correlation IDs for threading.

The critical relay design decision is polling interval vs. Vercel cold start behavior. Vercel Fluid Compute (enabled by default since April 2025) eliminates cold starts for 99.37% of requests. Short polling (every 30–60 seconds from the agent CLI) is viable without the cost and complexity of long-polling or WebSockets. This validates the v2.0 decision to avoid real-time streaming and use polling for now.

Token security: per-agent API tokens stored in VSCode SecretStore (already built in v1.0) is the correct approach. Token rotation and revocation are moderate-complexity additions, not table stakes for v2.0 single-user. For v3+ team features, a token vault pattern is the upgrade path.

---

## Feature Categories

### Category 1: Relay API (harnesstune-relay)

The relay is the backbone of all remote features. Everything else depends on it.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Document store (channels + messages) | Without this, no remote features work at all | Low | Generic channel-based model keeps relay dumb; all structure is client-side |
| Token-based auth (Bearer header) | Without auth, any agent can read any other agent's data | Low | One token per agent; stored in Turso, hashed not plaintext |
| POST /channels/:id/messages | Agents upload reports; command center posts feedback | Low | Standard REST endpoint; returns 201 + message ID |
| GET /channels/:id/messages | Command center reads reports; agents poll for instructions | Low | Returns array; supports `?since=` timestamp filter to avoid re-delivering old messages |
| PUT /channels/:id/agents/:id (registration) | First contact: agent registers and receives its token | Low | Returns token once; must be stored by agent CLI immediately |
| DELETE /channels/:id/messages/:id | Message acknowledgement / cleanup | Low | Soft delete or mark-as-read; prevents unbounded DB growth |
| Turso (SQLite) persistence | Need durable storage; Vercel serverless functions are ephemeral | Low | Turso HTTP driver works from Vercel Edge Functions; official integration documented |
| Vercel deployment (one-command) | Self-hosting must be easy or users will not bother | Low | `vercel deploy` from repo; documented Turso + Vercel integration exists |
| Health check endpoint (GET /health) | CLI and extension need to verify relay is reachable before use | Low | Returns 200 + relay version; used during workspace add flow |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Self-host script (single command) | Eliminates vendor lock-in; enables air-gapped/private networks | Medium | Docker Compose or `npx` bootstrap for LAN relay; requires documenting env vars |
| Message TTL / auto-expiry | Old reports don't accumulate indefinitely; keeps free Turso tier viable | Low | Configurable TTL per channel type (briefings: 30 days, ralph reports: 90 days) |
| `?since=` cursor pagination | Efficient polling without re-reading old messages on every poll cycle | Low | ISO timestamp or monotonic sequence ID as cursor; agents store last-seen ID locally |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| WebSocket / SSE on relay | Vercel serverless cannot hold persistent connections; adds operational complexity for negligible UX gain in v2 | Use short polling (30–60s). Real-time streaming is v3. |
| Relay-side message structure validation | Makes relay opinionated; breaks if report schema changes without redeploying relay | Keep relay as a dumb mailbox; validate structure client-side in CLI and extension |
| Multi-tenant user accounts | Multi-user is explicitly v3+; adding user management now adds auth complexity without payoff | Single-user model: one relay deployment per user; team features are a separate milestone |
| Relay-initiated push to extension | Would require extension to expose an inbound HTTP server; breaks the outbound-only networking model | Extension polls relay on a configurable interval |

#### Dependencies on v1.0

- SecretStore integration (v1.0): relay tokens are stored via `context.secrets`, the same mechanism used for v1.0 API keys. No new storage mechanism needed.

---

### Category 2: Agent CLI Sidecar (harnesstune-agent)

The CLI daemon runs on each remote machine alongside the agent system. It is the agent's "voice" to the relay.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `npx harnesstune-agent` zero-install entry point | Without this, setup friction on remote machines is too high | Low | Standard npx pattern; Node.js 20+ as only prerequisite |
| Agent registration (first run) | Generates token, registers with relay, writes config to `.harnesstune/config.json` | Low | Interactive prompt for relay URL; stores token in local config file, not env var |
| Report upload (POST to relay) | Core function: push structured reports to relay | Low | Reads report JSON from stdin OR from a watched file path |
| Message polling (GET from relay) | Core function: receive instructions from command center | Low | Short polling on configurable interval (default: 60s); exponential backoff on relay errors |
| Instruction routing to local agent | When message arrives, route it to the local agent system | Medium | Routing is framework-specific; v2 routes to Claude Code via `claude` CLI or stdin injection |
| Status heartbeat | Command center needs to know if the agent is still alive and polling | Low | Heartbeat is a special message type uploaded every N minutes; extension dims workspace if heartbeat is stale |
| Graceful shutdown / SIGTERM handling | Daemon must exit cleanly and clear its "online" status from relay | Low | Register SIGTERM handler; upload a "disconnected" status message before exit |
| Config file management (`.harnesstune/config.json`) | CLI needs persistent config between runs (relay URL, agent ID, token, poll interval) | Low | JSON file in agent's project root or `~/.harnesstune/`; documented schema |
| `--dry-run` flag | Engineers need to validate setup without uploading real data | Low | Prints what would be uploaded; does not hit relay |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Framework detection (auto-detect Claude Code vs OpenClaw vs generic) | Reduces manual config; CLI identifies what's running locally | Medium | Check for `.claude/settings.json` (Claude Code), `~/.openclaw/` (OpenClaw), fall back to generic JSONL watcher |
| Report generation from local state (not just passthrough) | CLI can synthesize a briefing from log files without the agent generating one explicitly | High | Parse Claude Code transcripts to generate goals/progress/blockers automatically; deferred to v2.1 unless agent generates reports natively |
| `npx harnesstune-agent report` command | Trigger an on-demand report upload outside the scheduled cycle | Low | Useful for: just finished a major task; want to checkpoint before going offline |
| Progress file watching (`progress.txt` / `prd.json`) | Ralph loop emits progress files to disk; CLI watches these and auto-uploads iteration reports | Medium | Uses `chokidar` (already used in v1.0 OpenClaw adapter); watch configurable paths |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Inbound HTTP server on remote machine | Requires open port and firewall rules; breaks the outbound-only networking model | Keep all traffic outbound from CLI to relay |
| Long-polling from CLI | Increases relay cost and complexity; 60s short polling is sufficient for async messaging | Short poll with exponential backoff on errors |
| Storing agent token in environment variable | Env vars leak into subprocess environments and shell history | Store in `.harnesstune/config.json` with 0600 permissions; document not to commit this file |
| Bundling agent runtime logic in CLI | CLI should observe and relay, not run the agent itself | CLI wraps existing agent systems; it is a sidecar, not an orchestrator |

#### Dependencies on v1.0

- OpenClaw JSONL tailing pattern (v1.0): the CLI's local log-reading logic mirrors the `OpenClawAdapter`'s `chokidar`-based file watcher. Same pattern, different execution environment (Node.js process vs. extension host).
- Claude Code hooks adapter (v1.0): the CLI's understanding of Claude Code's hook events and transcript format comes from the v1.0 integration work. The CLI can read the same transcript JSONL files that the v1.0 adapter watches.

---

### Category 3: Daily Briefing Reports

Structured agent state snapshots at configurable intervals. The "morning newspaper" for the engineer.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Goals field | Without goals, engineer cannot evaluate whether blockers are critical | Low | Free text; agent or CLI populates |
| Current progress field | Core of the briefing; what changed since the last report | Low | Free text or structured list |
| Blockers field | Highest-urgency information; engineer may need to intervene | Low | Null if no blockers; extension highlights non-null blockers prominently |
| Next steps field | Sets expectations; engineer knows what to check in the next report | Low | Free text |
| Metrics snapshot (tokens used, tasks completed, errors) | Without metrics, engineer cannot assess agent health | Low | Numeric fields; graphable over time |
| Timestamp and report ID | Required for timeline ordering and deduplication | Low | ISO 8601 timestamp; UUID report ID |
| Configurable schedule | "Every 6 hours" vs "daily at 8am" vs "on task completion" | Low | Cron expression or simple interval in CLI config; default: daily |
| Timeline view in extension | Reports must be readable in context; a chronological feed of reports per workspace | Medium | See Category 6 (Report Timeline UI) |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Blocker highlighting / badge | Blockers in any workspace surface in the sidebar as a red indicator, not just buried in the report | Low | Extension reads latest briefing; non-null `blockers` field triggers sidebar badge on workspace row |
| Stale report indicator | If last briefing is >48h old, workspace dims in sidebar | Low | Compare last report timestamp to `Date.now()`; uses the same "stale data dimming" pattern from v1.0 UX research |
| Multi-workspace morning summary | A roll-up view: all workspaces, latest briefing, blocker count | Medium | "Morning digest" command: aggregate latest briefing from each workspace into one panel |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Relay-enforced briefing schema | Relay must remain schema-agnostic | Define briefing schema in CLI (generates JSON) and extension (parses JSON); relay stores opaque document |
| Real-time briefing streaming | Briefings are snapshots, not streams; streaming adds complexity with no benefit | Upload full briefing as single JSON document; extension fetches on next poll cycle |
| Forcing the agent to generate its own briefing | Most agent frameworks don't natively generate structured reports | CLI can synthesize briefing from logs in v2.0; agent-generated briefings are a v2.1 feature when more frameworks support it |

#### Dependencies on v1.0

- Status indicators and dimming (v1.0): the sidebar status badge system (running / idle / warning / error) used in v1.0 is extended to show a "stale briefing" or "blocker present" state. Same badge infrastructure, new data source (relay instead of local file watcher).

---

### Category 4: Ralph Loop Progress Reports

Iteration-specific reports for agents running improvement loops. The "experiment log" for converging tasks.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Iteration number field | Without this, reports cannot be ordered into a sequence | Low | Integer; monotonically increasing per loop |
| Baseline metrics field | Sets the reference point for all delta calculations | Low | JSON object of named numeric metrics; defined once at loop start |
| Current metrics field | The measurement at this iteration | Low | Same schema as baseline; allows diff computation |
| Delta field | The difference from baseline (or from prior iteration) | Low | Computed client-side by extension or pre-computed by CLI; both approaches valid |
| What changed field | Human-readable description of what the agent tried differently this iteration | Low | Free text; the key diagnostic field |
| Cumulative improvement field | Overall progress from iteration 1 to now | Low | Computed from baseline vs. current metrics across all iterations |
| Loop ID | Ties all iteration reports for a single loop together | Low | UUID generated at loop start; all iterations carry the same loop ID |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Convergence chart in extension | Plot current metric vs. iteration number; visually shows converging / plateauing / regressing | Medium | Line chart in report detail panel; D3 or Recharts; reuses webview infrastructure from v1.0 |
| Convergence / plateau / regression status badge | Computed from last N iterations' delta trend; surfaces as a badge on the workspace | Medium | Simple trend detection: if delta is diminishing → "converging"; if delta near zero for 3+ iterations → "plateauing"; if delta negative → "regressing" |
| Loop comparison (A vs B) | Compare two ralph loops side by side (e.g., approach A vs approach B) | High | Deferred — requires UI investment; useful but not needed for v2.0 launch |
| Auto-upload from progress file watching | CLI watches `progress.txt` / `prd.json` and auto-generates iteration reports | Medium | Ralph loop emits these files natively (see ralph/snarktank, PageAI-Pro/ralph-loop); CLI watches and parses on change |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Enforcing a fixed metric schema | Different loops measure different things (accuracy, speed, cost, pass rate) | Generic named-metric design: `{ "metric_name": number }` map; CLI defines what to measure per loop |
| Real-time iteration streaming | Iterations complete over minutes or hours; no need for streaming | Upload full iteration report on each iteration completion; extension shows it on next poll |
| Mixing briefing and ralph report types in one feed | Two different information structures; mixing them makes both harder to read | Separate channels or message type field for routing; extension renders each type with its own component |

#### Dependencies on v1.0

- D3.js / chart infrastructure (v1.0): the convergence chart reuses the webview-based charting infrastructure established in v1.0 (event stream sparklines, D3 in webview). No new chart library needed.
- WebviewPanel lifecycle (v1.0): report detail panels follow the same `WebviewPanel` create/dispose/serialize lifecycle used for dashboard and schematic panels.

---

### Category 5: Async Chat / Feedback

Bidirectional messaging between engineer and remote agents through the relay.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Post message to agent from extension | Core feature; without it, "remote command center" is read-only | Low | POST to relay channel with message type `feedback`; displays in CLI's inbox on next poll |
| Agent response visible in extension | One-way messaging is insufficient; engineer needs to know the agent processed the instruction | Medium | Agent (via CLI) posts reply; extension fetches and appends to conversation thread |
| Per-workspace message thread | Messages must be scoped to a workspace/agent; a shared inbox across all agents would be unusable | Low | Channel ID = workspace ID; relay enforces isolation via token scope |
| Message timestamp and read status | Engineer needs to know if a message has been picked up by the agent | Low | `delivered_at` timestamp when agent polls and reads the message; `replied_at` when agent responds |
| Conversation history (last N messages) | Context for the current conversation; engineer should not need to re-read earlier reports | Low | GET /channels/:id/messages returns last 50 messages; extension renders as a threaded list |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Inline report commenting | From the report timeline, click "Reply" on a specific briefing → opens a pre-contextualized message with report ID attached | Medium | Message carries `in_reply_to_report_id`; CLI routes contextualized reply to agent with report content as context |
| Message delivery acknowledgement badge | Sidebar badge changes when agent acknowledges a message (moves from "sent" to "received") | Low | Agent CLI marks messages as read on poll; extension reflects this in conversation UI |
| Slash command routing | `/pause`, `/resume`, `/stop` sent as structured commands rather than free text | Medium | Parsed by CLI on receipt; routed to Claude Code session management. Mirrors v1.0 pause/resume/stop controls — same actions, remote delivery |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time chat (WebSocket) | Async messaging is sufficient; agent is not sitting watching a chat window waiting to respond instantly | Async polling model; clearly communicate to engineer that response will appear when agent next polls |
| Separate chat UI from report timeline | If chat and reports are in separate panels, context is lost | Unified report + chat thread view per workspace; reports and messages interleaved chronologically |
| Broadcasting messages to all agents | Mass-broadcast is an anti-pattern in single-user v2.0; you want targeted, per-agent communication | Post to specific workspace channel only |

#### Dependencies on v1.0

- Chat interface (v1.0): the v1.0 chat panel (webview-based, Claude Code backend) established the UX pattern and webview messaging infrastructure. The v2.0 async chat uses the same webview component with a different transport layer (relay instead of PTY).
- SecretStore (v1.0): the relay token used to authenticate message posts is stored in the same SecretStore as v1.0 API keys.

---

### Category 6: Remote Workspace Management (Sidebar)

How remote workspaces appear and are managed in the HarnessTune sidebar.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| "Add Remote Workspace" command | Entry point for all remote features; without this, no remote workspaces can be added | Low | QuickInput flow: relay URL → agent token → test connection → save |
| Remote workspaces visible in sidebar alongside local ones | Core UX promise: "one place for all your agents" | Medium | RemoteAdapter plugs into existing workspace registry; sidebar renders remote entries using existing status badge infrastructure |
| Status indicators for remote workspaces (running / idle / error / stale) | Engineer needs at-a-glance health for remote agents, same as local | Low | Derived from latest briefing report: timestamp determines "stale", metrics determine "idle" vs "running", error field determines "error" |
| View reports (click workspace → report timeline) | The primary way to read agent output | Medium | Opens editor panel with report timeline; see Category 7 |
| Send message (right-click → Message Agent) | Access to async chat from the sidebar | Low | Opens existing chat panel with relay transport; right-click context menu item |
| Configure remote workspace (relay URL, poll interval, token) | Engineers need to update config without removing and re-adding the workspace | Low | Context menu → Configure → QuickInput; updates workspace registry |
| Remove remote workspace | Clean up disconnected agents | Low | Context menu → Remove → confirmation → deletes from registry; does not delete relay data |
| Connection error handling (relay unreachable, token invalid) | Without graceful error handling, "error" state is ambiguous | Low | Distinguish: relay unreachable (network error badge), token invalid (401 badge with re-configure prompt), stale data (dim + timestamp) |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bulk status view (all remote workspaces health at a glance) | With 5+ remote agents, the engineer needs a summary without clicking each one | Medium | Dashboard-style rollup panel: all workspaces in a grid, latest briefing summary card per workspace |
| Last-seen timestamp in sidebar row | Without this, "idle" and "disconnected" look the same | Low | Render "last seen X ago" under workspace name; computed from last heartbeat/briefing timestamp |
| Relay URL grouping (workspaces sharing a relay are visually grouped) | Engineers with multiple relays (e.g., work relay vs. personal relay) need to distinguish them | Low | Group workspace list by relay URL with collapsible headers |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Separate "remote" section in sidebar | Creates a two-tier UX; remote workspaces should feel first-class, not segregated | Render local and remote workspaces in the same list with a small "remote" icon indicator on each row |
| Polling every 5 seconds from extension to relay | Hammers the relay with unnecessary requests; Turso free tier has query limits | Poll on configurable interval (default: 60s); allow manual refresh via "Refresh" command |
| Token entry as plaintext in settings.json | Tokens in settings.json are readable by other extensions | Use QuickInput (password mode) for token entry; store via SecretStore immediately |

#### Dependencies on v1.0

- Workspace registry (v1.0): remote workspaces are entries in the same registry as local workspaces. Registry schema gains a `type: "remote"` discriminant and `relayUrl`, `agentToken` fields.
- Sidebar WebviewView (v1.0): no new sidebar infrastructure needed. RemoteAdapter plugs into the existing adapter registration pattern; sidebar renders remote workspaces using the same status badge components.
- Adapter pattern (v1.0): `RemoteAdapter` is a new implementation of the existing `AgentBackendAdapter` interface. The interface contract (connect / disconnect / onEvent / getActiveSessions) remains unchanged; implementation uses relay HTTP instead of local file watcher or hook server.
- SecretStore (v1.0): agent tokens stored via `context.secrets`.
- Context menu (v1.0): right-click menu on workspace rows is already implemented. New remote-specific commands ("Message Agent", "View Reports") are added as conditional menu items based on `type === "remote"`.

---

### Category 7: Report Timeline UI (Extension)

How reports are rendered in the editor panel. The "inbox" for agent output.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Chronological report feed per workspace | Without ordering, reports are not navigable | Low | Descending time order (newest first); sorted by `timestamp` field |
| Briefing report card (renders goals / progress / blockers / next steps / metrics) | Core display unit for daily briefings | Medium | WebviewPanel component; collapsible sections; blockers section highlighted in amber/red if non-empty |
| Ralph loop report card (renders iteration / baseline / current / delta / what changed) | Core display unit for ralph loop reports | Medium | Separate component from briefing card; numeric delta rendered as +/- with color (green positive, red negative) |
| Convergence chart (line chart of metric over iterations) | Without this, ralph loop reports are just a list of numbers | Medium | D3 line chart in webview; one line per metric; x-axis = iteration, y-axis = metric value |
| Report type filtering (briefings / ralph reports / all) | With both report types in one feed, unfiltered view is noisy | Low | Filter tabs or dropdown; persisted in webview state |
| Interleaved chat messages | Chat messages from the engineer and agent responses should appear in the same timeline as reports | Low | Different visual treatment: chat messages appear as chat bubbles; reports appear as cards; same chronological feed |
| "Reply" button on report cards | Primary entry point for inline commenting on a specific report | Low | Opens message compose area pre-filled with `in_reply_to_report_id` |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Blocker call-out box | Blockers are the highest-priority information in a briefing; they should not require scanning the full card to find | Low | Render a prominent amber/red call-out box at top of briefing card when blockers field is non-empty |
| Metrics sparklines on briefing card | Show token-use and error-count trends inline in the briefing card without needing a separate chart | Medium | Mini D3 sparklines; reuses sparkline component from v1.0 (event stream panel) |
| Loop status badge on ralph report cards | "Converging" / "Plateauing" / "Regressing" computed from delta trend | Medium | Computed from last 3 iterations; color-coded badge on report card header |

#### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Infinite scroll for report timeline | Unbounded list causes memory pressure in webview | Paginate: load last 20 reports on open, "Load more" button for history; virtual scrolling if list grows large |
| Rendering report HTML from relay | Relay stores JSON; rendering is the extension's job | Extension owns rendering; relay stores structured JSON documents only |
| Mixing report timeline with the agent schematic (SVG topology) | Reports are text-centric; topology is graph-centric; merging them makes both worse | Keep report timeline as a separate `WebviewPanel` from the schematic panel; they can be open side-by-side |

#### Dependencies on v1.0

- WebviewPanel lifecycle (v1.0): report timeline panel follows the same create/dispose/serialize lifecycle as dashboard and schematic panels.
- D3 and sparklines (v1.0): sparklines in briefing cards reuse the sparkline component built in v1.0 (Phase 4, event stream + sparklines). No new chart library needed.
- React component infrastructure (v1.0): briefing and ralph report cards are new React components in the existing webview React app. No new framework needed.
- Typed postMessage contracts (v1.0): extension host fetches reports from relay and pushes them to the webview via the existing typed `postMessage` channel. Same message-passing infrastructure, new message types.

---

## Feature Dependencies Map

```
Relay API
  └── All remote features depend on this (cannot build any v2.0 feature without it)

Agent CLI (harnesstune-agent)
  ├── Depends on: Relay API
  ├── Enables: Daily Briefing Reports (upload path)
  ├── Enables: Ralph Loop Progress Reports (upload path)
  └── Enables: Async Chat / Feedback (polling path)

RemoteAdapter (extension)
  ├── Depends on: Relay API
  ├── Depends on: v1.0 Adapter pattern interface
  ├── Depends on: v1.0 Workspace Registry
  └── Enables: Remote Workspace Management (sidebar integration)

Remote Workspace Management (sidebar)
  ├── Depends on: RemoteAdapter
  ├── Depends on: v1.0 Sidebar WebviewView
  └── Enables: Report Timeline UI (click workspace → opens panel)

Report Timeline UI
  ├── Depends on: RemoteAdapter (data source)
  ├── Depends on: v1.0 WebviewPanel lifecycle
  └── Depends on: v1.0 D3 / sparkline infrastructure

Daily Briefing Reports
  ├── Depends on: Agent CLI (upload) + RemoteAdapter (download)
  └── Feeds into: Report Timeline UI

Ralph Loop Progress Reports
  ├── Depends on: Agent CLI (upload) + RemoteAdapter (download)
  └── Feeds into: Report Timeline UI (convergence chart)

Async Chat / Feedback
  ├── Depends on: Relay API (both directions)
  ├── Depends on: Agent CLI (polling / routing)
  └── Feeds into: Report Timeline UI (interleaved messages)

Token-Based Auth
  ├── Depends on: v1.0 SecretStore
  └── Required by: All relay API calls and agent CLI registration
```

**Build order implied by dependency graph:**
1. Relay API + token auth (unblocks everything)
2. Agent CLI with registration + upload + polling (unblocks reports and chat)
3. RemoteAdapter (unblocks sidebar integration)
4. Remote Workspace Management / sidebar (unblocks report access)
5. Report Timeline UI (unblocks report reading)
6. Daily Briefing Reports + Ralph Loop Reports (parallel: report types are independent of each other)
7. Async Chat (can follow or parallel with report types; shares relay infrastructure)

---

## MVP Recommendation

**Minimum viable v2.0 (must ship together as a working system):**

1. Relay API — document store + token auth + health check
2. Agent CLI — registration + briefing upload + short polling for messages
3. RemoteAdapter — fetches briefings from relay, surfaces as workspace events
4. Remote Workspace Management — add/view/remove in sidebar
5. Report Timeline UI — briefing cards only (ralph loop cards can follow)

**Defer to v2.1 without blocking v2.0:**

- Ralph loop progress reports — useful but requires agents running ralph loops; briefings are universally applicable
- Async chat feedback — relay and CLI are built by v2.0; adding bidirectional message routing is incremental
- Multi-workspace morning summary rollup — useful with 5+ workspaces; single-workspace experience must work first
- Loop comparison (A vs B) — high complexity, low urgency
- Auto-synthesize briefing from logs (CLI parsing transcripts) — agent-generated briefings are simpler; synthesis is v2.1

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Relay/mailbox pattern design | HIGH | Well-established async messaging architecture; HTTP Mailbox pattern documented since 2013; Azure, AWS, AgentMail all implement variants |
| Vercel + Turso relay stack | HIGH | Official Turso-Vercel integration documented; Fluid compute eliminates cold starts for polling use case |
| Short polling feasibility | HIGH | 60s short polling is viable given Vercel Fluid compute; Turso HTTP driver supports this access pattern |
| Agent CLI sidecar pattern | HIGH | Sidecar pattern is established in distributed systems; Sensu, Datadog, Kubernetes all use this model |
| Daily briefing report format | HIGH | Maps directly to async standup conventions; fields are universally understood |
| Ralph loop structure | HIGH | Well-documented upstream (vercel-labs/ralph-loop-agent, snarktank/ralph); progress.txt and prd.json are established emission points |
| Convergence chart UX | MEDIUM | Pattern exists in ML experiment tracking tools (MLflow, W&B); no direct prior art in agent management IDEs |
| Async chat through relay | HIGH | Standard async request-reply pattern; correlation ID threading is established |
| Token auth design | HIGH | Per-agent bearer token is standard; SecretStore storage is established from v1.0 |
| Report timeline UI | MEDIUM | Pattern exists in Genesys Cloud (agent timeline), Datadog (deployment timeline); no direct VSCode extension prior art |

---

## Sources

- [HTTP Mailbox — Asynchronous RESTful Communication (ODU, 2013)](https://digitalcommons.odu.edu/cgi/viewcontent.cgi?article=1026&context=computerscience_etds)
- [Asynchronous Request-Reply Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply)
- [Turso + Vercel Integration](https://github.com/tursodatabase/turso-vercel)
- [Turso Serverless JavaScript Driver](https://turso.tech/blog/introducing-turso-serverless-javascript-driver)
- [Vercel Fluid Compute — Scale to One](https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts)
- [Sidecar Pattern — System Design Newsletter](https://newsletter.systemdesign.one/p/sidecar-pattern)
- [Short Polling — Backend Communication Patterns](https://medium.com/@tanmoysantra67/backend-communication-patterns-short-polling-b6a21767a0bb)
- [Ralph Loop — Alibaba Cloud Community (ReAct to Ralph)](https://www.alibabacloud.com/blog/from-react-to-ralph-loop-a-continuous-iteration-paradigm-for-ai-agents_602799)
- [ralph — snarktank GitHub](https://github.com/snarktank/ralph)
- [ralph-loop — PageAI-Pro GitHub](https://github.com/PageAI-Pro/ralph-loop)
- [vercel-labs/ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent)
- [How to Build Self-Improving AI Agents with the Ralph Loop Method](https://www.howdoiuseai.com/blog/2026-01-19-how-to-build-self-improving-ai-agents-with-the-ral)
- [AI Agent Authentication Methods — Stytch](https://stytch.com/blog/ai-agent-authentication-methods/)
- [Token Best Practices — Auth0](https://auth0.com/docs/secure/tokens/token-best-practices)
- [AgentMail — Email Inbox API for AI Agents](https://www.agentmail.to/)
- [Datadog Remote Agent Management](https://docs.datadoghq.com/agent/fleet_automation/remote_management/)
- [Cursor Remote Agents (April 2026)](https://www.buildfastwithai.com/blogs/cursor-remote-agents-any-device-2026)
- [Supporting Remote Development — VSCode Extension API](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [Messaging Architecture Patterns](https://medium.com/@mahernaija/messaging-patterns-cf4bc5b164cf)
