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
