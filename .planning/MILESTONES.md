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
