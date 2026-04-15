# ROADMAP: HarnessTune

**Project:** HarnessTune — VSCode Extension for Agent Harness Engineering
**Core Value:** Engineers running multiple agent systems can see the health, topology, and status of every agent across every workspace — and interact with any of them — from one place inside VSCode.
**Created:** 2026-04-16
**Status:** Active

---

## Milestone 1: Core Agent IDE

All five phases below constitute Milestone 1. Completion delivers a functional, dogfoodable agent IDE covering workspace management, live Claude Code monitoring, interactive topology visualization, embedded terminal chat, and workspace scaffolding with a second adapter.

---

## Phases

- [ ] **Phase 1: Foundation — Extension Scaffold, Registry, Sidebar** - Extension loads, workspaces can be added/removed, sidebar renders with status indicators
- [ ] **Phase 2: Claude Code Adapter + Dashboard** - First end-to-end data pipeline from Claude Code hooks through to live dashboard display with agent controls
- [ ] **Phase 3: Agent Schematic (Live Topology)** - Interactive D3/React Flow graph showing real-time agent hierarchy reconstructed from hook events
- [ ] **Phase 4: Chat Interface + Terminal** - Embedded terminal per workspace routing to the configured LLM backend
- [ ] **Phase 5: Workspace Scaffolding + OpenClaw Adapter** - Template-based workspace creation and a second adapter proving the adapter pattern generalizes

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

**Plans:** 3 plans

Plans:
- [ ] 01-PLAN-extension-scaffold.md — Extension scaffold, esbuild build, shared type contracts
- [ ] 02-PLAN-workspace-registry.md — Workspace registry, file watchers, secrets storage
- [ ] 03-PLAN-sidebar-statusbar.md — React sidebar WebviewView, status badges, status bar

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

**Plans:** 3 plans

Plans:
- [ ] 01-PLAN-extension-scaffold.md — Extension scaffold, esbuild build, shared type contracts
- [ ] 02-PLAN-workspace-registry.md — Workspace registry, file watchers, secrets storage
- [ ] 03-PLAN-sidebar-statusbar.md — React sidebar WebviewView, status badges, status bar

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

**Plans:** 3 plans

Plans:
- [ ] 01-PLAN-extension-scaffold.md — Extension scaffold, esbuild build, shared type contracts
- [ ] 02-PLAN-workspace-registry.md — Workspace registry, file watchers, secrets storage
- [ ] 03-PLAN-sidebar-statusbar.md — React sidebar WebviewView, status badges, status bar

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

**Plans:** 3 plans

Plans:
- [ ] 01-PLAN-extension-scaffold.md — Extension scaffold, esbuild build, shared type contracts
- [ ] 02-PLAN-workspace-registry.md — Workspace registry, file watchers, secrets storage
- [ ] 03-PLAN-sidebar-statusbar.md — React sidebar WebviewView, status badges, status bar

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
- [ ] 01-PLAN-extension-scaffold.md — Extension scaffold, esbuild build, shared type contracts
- [ ] 02-PLAN-workspace-registry.md — Workspace registry, file watchers, secrets storage
- [ ] 03-PLAN-sidebar-statusbar.md — React sidebar WebviewView, status badges, status bar

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Extension Scaffold, Registry, Sidebar | 0/3 | Planned | - |
| 2. Claude Code Adapter + Dashboard | 0/? | Not started | - |
| 3. Agent Schematic (Live Topology) | 0/? | Not started | - |
| 4. Chat Interface + Terminal | 0/? | Not started | - |
| 5. Workspace Scaffolding + OpenClaw Adapter | 0/? | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Pending |
| FOUN-02 | Phase 1 | Pending |
| FOUN-03 | Phase 1 | Pending |
| FOUN-04 | Phase 1 | Pending |
| WKSP-01 | Phase 1 | Pending |
| WKSP-03 | Phase 1 | Pending |
| WKSP-04 | Phase 1 | Pending |
| WKSP-05 | Phase 1 | Pending |
| SIDE-01 | Phase 1 | Pending |
| SIDE-02 | Phase 1 | Pending |
| SIDE-03 | Phase 1 | Pending |
| SIDE-04 | Phase 1 | Pending |
| SIDE-05 | Phase 1 | Pending |
| DASH-01 | Phase 2 | Pending |
| DASH-02 | Phase 2 | Pending |
| DASH-03 | Phase 2 | Pending |
| DASH-04 | Phase 2 | Pending |
| DASH-05 | Phase 2 | Pending |
| CTRL-01 | Phase 2 | Pending |
| CTRL-02 | Phase 2 | Pending |
| CTRL-03 | Phase 2 | Pending |
| CTRL-04 | Phase 2 | Pending |
| CCAD-01 | Phase 2 | Pending |
| CCAD-02 | Phase 2 | Pending |
| CCAD-03 | Phase 2 | Pending |
| CCAD-04 | Phase 2 | Pending |
| CCAD-05 | Phase 2 | Pending |
| CCAD-06 | Phase 2 | Pending |
| NOTF-01 | Phase 2 | Pending |
| NOTF-02 | Phase 2 | Pending |
| NOTF-03 | Phase 2 | Pending |
| SCHM-01 | Phase 3 | Pending |
| SCHM-02 | Phase 3 | Pending |
| SCHM-03 | Phase 3 | Pending |
| SCHM-04 | Phase 3 | Pending |
| SCHM-05 | Phase 3 | Pending |
| SCHM-06 | Phase 3 | Pending |
| CHAT-01 | Phase 4 | Pending |
| CHAT-02 | Phase 4 | Pending |
| CHAT-03 | Phase 4 | Pending |
| CHAT-04 | Phase 4 | Pending |
| WKSP-02 | Phase 5 | Pending |

**v1 Coverage: 41/41 requirements mapped. No orphans.**

Note: Phase 5 covers WKSP-02 (scaffold-based workspace creation) from v1 requirements, plus the OpenClaw adapter groundwork which anticipates ADPT-01 from v2. The OpenClaw adapter work is included in Phase 5's scope as a proving exercise for the adapter pattern; the full v2 adapter suite (Paperclip, OpenCode, generic) remains out of scope for Milestone 1.

---

## Key Architectural Constraints (for plan-phase reference)

These decisions are locked. Plan-phase should not re-litigate them.

| Decision | Rationale |
|----------|-----------|
| `sql.js` for SQLite, NOT `better-sqlite3` | `better-sqlite3` requires native C++ compiled against VSCode's specific Electron version; `sql.js` uses WebAssembly, zero compilation issues |
| VSCode native `Pseudoterminal` for v1 terminal, NOT `node-pty` | `node-pty` requires native binaries per platform (win32/darwin/linux, arm64/x64); complex VSIX packaging; defer to v2 |
| D3.js for live topology, NOT Mermaid | Mermaid cannot dynamically add/remove nodes without full DOM re-render + flicker; click events have known bugs; CSP concerns in webview context |
| `WebviewView` for sidebar, NOT `TreeView` | Custom health indicators (badges, sparklines) exceed `TreeView` rendering capability |
| `acquireVsCodeApi()` called once per webview, stored in module scope | Throws on second call — the most common webview bug |
| `retainContextWhenHidden: true` on terminal panel ONLY | Each retained panel holds 80–150MB browser context; use `getState/setState` for all data panels |
| Absolute paths in workspace registry | VSCode opens in different working directories; relative paths silently resolve incorrectly |
| `RelativePattern` with absolute base for all file watchers | String glob patterns only watch inside the current VSCode workspace folder; agent dirs are typically outside it |
| `@vscode/webview-ui-toolkit` — DO NOT USE | Officially deprecated January 2025; use VSCode Elements or plain CSS with VSCode CSS variables |

---

*Roadmap created: 2026-04-16*
*Last updated: 2026-04-16 — initial creation after requirements definition and research synthesis*
