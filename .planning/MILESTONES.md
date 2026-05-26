# Milestones

## v1.0: Core Agent IDE

**Status:** Complete (2026-04-19)
**Phases:** 5 (all complete)

**What shipped:**
- Extension scaffold, workspace registry, file watchers, secrets store
- Sidebar with workspace list, status indicators, context menu (configure/remove)
- Claude Code adapter via hooks (PreToolUse/PostToolUse event pipeline)
- Dashboard with agent cards, detail panel, pause/resume/stop controls
- Notification service (error toasts, workspace status tracking)
- Agent schematic (SVG topology graph with live status, zoom/pan, fit-to-view)
- Chat interface (webview-based, Claude Code backend, interrupt support)
- Workspace scaffolding (templates: claude-code-basic, multi-agent, openclaw-basic)
- OpenClaw adapter (JSONL file tailing, chokidar watcher)
- Configure workspace (backend type switching via context menu)
- Status bar with aggregate workspace health

## v2.0: Remote Agent Management

**Status:** Complete (2026-04-21)
**Phases:** 5 (phases 6–10, all complete)

**What shipped:**
- Type consolidation (BackendType canonical, WorkspaceMode discriminant, registry v2 migration)
- pnpm monorepo with TypeScript project references (4 workspace packages)
- Relay API on Vercel + Turso (channel registration, token auth, report/message/timeline endpoints)
- Agent CLI sidecar (register, start, stop, report subcommands, 5-min heartbeat, retry queue)
- RemoteAdapter (30s polling with backoff, synthetic AgentEvents, cursor persistence)
- Add Remote Workspace flow (QuickInput, auto health-check, SecretStore tokens)
- Reports panel (timeline feed, briefing/ralph cards, SVG charts, chat bubbles, message composer)
- Sidebar: cloud badge, relay hostname, stale hint, Message Agent context menu
- Multi-pane layout persistence (dashboard/schematic/reports/chat serializers)

## v3.0: Multi-Platform Fleet

**Status:** SHIPPED (2026-05-26, tagged v0.1.0)
**Phases:** 7 (phases 11–17, all complete) + v3.1 followups

**What shipped:**
- Multi-agent/model relay extensions (Phase 11)
- Collector daemon scaffold with one-shot setup (Phase 12) — pluggable platform architecture, retry queue, daemon heartbeat
- Paperclip board adapter (Phase 13) — credential validation, cross-plugin readline lifecycle
- Claude Desktop scheduled tasks + Claude Code crontab adapters (Phase 14) — mtime guards, staleness filtering, atomic wrapper script generation
- OpenClaw remote adapter (Phase 15) — JSONL session segmentation, mappers, daemon integration
- Fleet dashboard (Phase 16) — 3-level navigation (fleet → workspace → agent), cost summary, date range persistence, FleetDataProvider abstraction
- Proactive alerts (Phase 17) — AlertEngine (60s polling, stale detection via 2× cron interval), status-bar bell badge, summary toast with "View Fleet Dashboard" action
- v3.1 followups (2026-05-09 to 2026-05-26): Paperclip API shape rewrite, relay /reports → agent_runs fanout, empty-state copy, fleet workspace dedup, automated UAT relay-live jest suite (13 tests)
- VSIX 1.23 MB, 26 files. Live VS Code UAT all green.

## v3.2: Async Persistent Chat (in progress)

**Status:** Planning complete (2026-05-27); Codex implementation underway
**Phases:** 1 (Phase 18)
**Plan:** `.planning/v3.2-async-chat/PLAN.md`

**Why this milestone exists:**
v3.0's `harnesstune-agent` ships with a half-finished `routeMessage`: every inbound message starts a fresh `claude -p` (no session continuity), and Claude's stdout is silently dropped on Mac B instead of POSTed back to the relay. End-to-end chat from Mac A → claude on Mac B → response in timeline does not work. This milestone closes that gap.

**What will ship:**
- Persistent Claude session per channel via `claude --resume <session-id>` (captured on first reply from `--output-format json` output)
- Response capture: full stdout/stderr POSTed back as `chat_response` report
- VS Code timeline pairs `chat_response` reports with their originating outbound message as conversation threads
- Serial Claude calls per agent (no parallelism)
- No new runtime deps, no relay changes, in-house ~10-line serial queue
