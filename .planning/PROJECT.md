# HarnessTune

## What This Is

A VSCode extension purpose-built for agent harness engineering — monitoring, managing, and orchestrating multi-agent systems from a single unified interface. Inspired by cmux's vertical-tab layout, HarnessTune gives engineers a tmux-like multi-pane workspace manager where each workspace encapsulates a complete agent architecture with its own dashboard, interactive schematic, and chat interface.

## Core Value

Engineers running multiple agent systems can see the health, topology, and status of every agent across every workspace — and interact with any of them — from one place.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Main dashboard showing aggregate health across all workspaces
- [ ] Workspace model: each workspace = one multi-agent system with isolated config/logs/state
- [ ] Per-workspace mini dashboard with historical stats (uptime, tokens, tasks, errors, cost)
- [ ] Interactive agent schematic (mermaid-style) with click-to-inspect (role, status, config, instructions, recent actions)
- [ ] Chat interface via embedded terminal (pass-through PTY to Claude Code, OpenCode, etc.)
- [ ] Sidebar with workspace list and status indicators
- [ ] Dual workspace creation: "Connect" (point at existing agent directory) and "Create" (scaffold from templates)
- [ ] Claude Code adapter as first backend integration (CLI / Agent SDK)
- [ ] Adapter pattern for pluggable agent backend integrations

### Out of Scope

- Standalone desktop app — VSCode extension for v1, standalone possible in v2
- Cloud/SaaS component — local-first in v1
- Building agent frameworks — integrates with existing ones
- Full IDE replacement — leverages VSCode as the host
- Real-time collaborative editing — single-user for v1

## Context

- **Inspiration:** cmux (Ghostty-based terminal with vertical tabs and notification panel for macOS) — the layout model, not the terminal implementation
- **Ecosystem problem:** AI agent architectures are fragmenting across Claude Code, OpenClaw, Paperclip, and custom frameworks. No unified monitoring/management solution exists.
- **Target user:** Initially internal dogfooding, then open-source for community adoption
- **Agent backends (priority order):** Claude Code (P0), OpenClaw (P1), Paperclip (P1), Custom/generic adapter (P2)

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

---
*Last updated: 2026-04-16 after initial project definition*
