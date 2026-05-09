# HarnessTune

## What This Is

A VSCode extension purpose-built for agent harness engineering — monitoring, managing, and orchestrating multi-agent systems from a single unified interface. Inspired by cmux's vertical-tab layout, HarnessTune gives engineers a tmux-like multi-pane workspace manager where each workspace encapsulates a complete agent architecture with its own dashboard, interactive schematic, and chat interface.

## Core Value

Engineers running multiple agent systems can see the health, topology, and status of every agent across every workspace — and interact with any of them — from one place.

## Current Milestone: v3.0 Multi-Platform Agent Fleet Management

**Goal:** HarnessTune becomes a centralized control plane for monitoring agent fleets across multiple remote machines — one workspace per platform, multiple agents (cron jobs / scheduled tasks) per workspace, with historical reporting at the individual agent level.

**Target features:**
- Multi-agent workspace model — workspace = platform instance on a machine, agent = individual cron job or scheduled task
- Paperclip adapter — pull from Paperclip's existing API/DB (audit trails, cost, task history, heartbeat schedules)
- Claude Desktop scheduled task integration — discover and report on Desktop's scheduled task runs
- Enhanced agent CLI — easy `npx harnesstune-agent setup` with guided onboarding, platform auto-detection
- Per-agent historical reporting — run history, logs, error patterns, cost/tokens, multi-day summaries
- Proactive alerts — "agent X hasn't reported in 24h", failure rate thresholds, delivered as VS Code notifications + optional relay digest
- Fleet dashboard — aggregate view across all platforms/machines, drill-down to individual agent run history

## Requirements

### Validated (v1.0)

- [x] Extension scaffold, workspace registry, file watchers, secrets store
- [x] Sidebar with workspace list, status indicators, context menu
- [x] Claude Code adapter via hooks (PreToolUse/PostToolUse event pipeline)
- [x] Dashboard with agent cards, detail panel, pause/resume/stop controls
- [x] Agent schematic (SVG topology graph with live status, zoom/pan, fit-to-view)
- [x] Chat interface (webview-based, Claude Code backend, interrupt support)
- [x] Workspace scaffolding (templates: claude-code-basic, multi-agent, openclaw-basic)
- [x] OpenClaw adapter (JSONL file tailing, chokidar watcher)
- [x] Configure workspace (backend type switching via context menu)
- [x] Status bar with aggregate workspace health

### Validated (v2.0)

- [x] Relay API — REST mailbox with Turso (SQLite) backend, Vercel serverless hosting
- [x] Agent CLI — Node.js sidecar for remote machines, report upload + message polling
- [x] RemoteAdapter — extension adapter connecting to relay for remote workspaces
- [x] Daily briefing reports — structured agent state snapshots on configurable schedule
- [x] Ralph loop progress reports — iteration tracking with baseline/current/delta metrics
- [x] Async chat/feedback — bidirectional messaging through relay
- [x] Remote workspace management — add, view, configure, remove remote workspaces
- [x] Token-based authentication — per-agent API tokens, SecretStore integration

### Active

- [ ] Multi-agent workspace model — workspace = platform, agent = cron job / scheduled task
- [ ] Paperclip adapter — integrate with Paperclip's API for agent data, audit trails, cost
- [ ] Claude Desktop scheduled task adapter — discover and report on scheduled task runs
- [ ] Enhanced agent CLI onboarding — `npx harnesstune-agent setup` with guided install, platform detection
- [ ] Per-agent historical reporting — run history, logs, errors, cost/tokens over multi-day windows
- [ ] Proactive alerts — stale agent detection, failure rate thresholds, VS Code notifications
- [ ] Fleet dashboard — aggregate view across platforms, drill-down to agent run history

### Out of Scope

- Real-time streaming — async/polling pattern works, live WebSocket/SSE is future
- Agent orchestration — v3 is observe + report, automated coordination is future
- Multi-user / team features — single user for now, team features are future
- Mobile app — VSCode only, mobile companion for reading reports is future
- End-to-end encryption — relay sees plaintext, E2E encryption is future
- Building agent frameworks — integrates with existing ones only

## Context

- **Inspiration:** cmux (Ghostty-based terminal with vertical tabs and notification panel for macOS) — the layout model, not the terminal implementation
- **Ecosystem problem:** AI agent architectures are fragmenting across Claude Code, OpenClaw, Paperclip, and custom frameworks. No unified monitoring/management solution exists.
- **Target user:** Initially internal dogfooding, then open-source for community adoption
- **Agent backends (priority order):** Claude Code (P0), OpenClaw (P1), Paperclip (P1), Custom/generic adapter (P2)
- **Architecture:** Relay/mailbox pattern — agents and command center both make outbound HTTPS to a shared REST relay. No inbound ports, no NAT traversal, no tunnels. "Just works" over the internet.
- **Stack:** Relay on Vercel (serverless) + Turso (SQLite edge DB, 9GB free tier). Self-hostable for air-gapped networks.
- **API design:** Generic channel-based document store — relay is a dumb mailbox, all report structure lives client-side
- **v3.0 platforms:** Paperclip (orchestration layer with own API), Claude Code/Desktop (sidecar + scheduled tasks), OpenClaw (JSONL + sidecar)
- **v3.0 deployment:** Multiple remote Macs, each running one or more platforms, all reporting through the same relay
- **v3.0 usage pattern:** Check in every few days, see multi-day agent history at cron-job granularity

## Constraints

- **Platform:** VSCode Extension API (TypeScript) — leverages marketplace distribution and existing user base
- **UI:** React inside VSCode webview panels for custom UI
- **Diagrams:** Mermaid.js or D3.js for agent topology schematics
- **State:** Local SQLite or JSON for workspace config/history
- **Chat:** Embedded terminal (PTY pass-through) — avoids reinventing CLI tool UX
- **License:** MIT
- **Repo:** github.com/hksulGithub/harnesstune

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| VSCode extension over standalone app | Marketplace distribution, existing user base, lower barrier to adoption | — Pending |
| Embedded PTY for chat interface | Leverages existing CLI tool UX (Claude Code, OpenCode), simpler v1 | — Pending |
| cmux-inspired layout (vertical tabs + workspace panes) | Proven UX for managing multiple sessions, familiar to terminal users | — Pending |
| Dual workspace mode (Connect + Create) | Supports both existing projects and new scaffolding workflows | — Pending |
| Claude Code as first adapter | Most relevant to internal dogfooding, best-documented API | — Pending |
| Agent schematic shows both stats AND config | Engineers need operational data and architectural context in one view | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-19 after milestone v2.0 started*
