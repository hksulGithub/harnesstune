# Phase 2: Claude Code Adapter + Dashboard - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Claude Code hook events flow end-to-end into a live dashboard panel where users can inspect agent detail and pause, resume, or stop running agents. Covers requirements DASH-01–05, CTRL-01–04, CCAD-01–06, NOTF-01–03.

</domain>

<decisions>
## Implementation Decisions

### Hook Server Architecture
- **D-01:** Embedded HTTP server in extension host using Node's built-in `http` module. No Express or external HTTP frameworks.
- **D-02:** Dynamic port allocation via `server.listen(0)`. Port written to `globalStorageUri/hook-server.port` so other components can discover it.
- **D-03:** Security: Bind to `127.0.0.1` only + random session token in URL query param. Reject requests without valid token.
- **D-04:** Direct HTTP hooks (`"type": "http"`) — Claude Code POSTs event JSON directly to the server URL. No shell wrappers.
- **D-05:** Subscribe to 9 Claude Code events: `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`.
- **D-06:** Resilience: Return `200 {"continue": true}` fast within Claude Code's 5-second timeout. Queue events in memory, flush to SQLite asynchronously. Never block Claude Code.

### AgentEvent Schema
- **D-07:** OTel GenAI-aligned `AgentEvent` interface with fields: `id`, `workspaceId`, `sessionId`, `agentId`, `eventType`, `timestamp`, `toolName?`, `toolInput?`, `model?`, `tokenUsage?`, `error?`, `raw`.

### Settings.json Integration
- **D-08:** Deep merge into `~/.claude/settings.json` with `"_harnesstune": true` tag on all injected hook entries. Atomic writes (write to temp file + rename). Create backup of original before first write.
- **D-09:** On disconnect, remove only entries tagged with `"_harnesstune": true`. Never touch user-defined hooks.

### Dashboard Panel Architecture
- **D-10:** Single `WebviewPanel` (not `WebviewView`) for the dashboard. Sidebar stays as Phase 1's quick-glance workspace list. Clicking a workspace in the sidebar opens/focuses the dashboard panel.
- **D-11:** Two-level hierarchy layout: Workspace tabs at top (per-workspace + "All Workspaces" aggregate), summary bar below tabs, master-detail split below (agent cards left, detail panel right).
- **D-12:** Master-detail pattern within the same panel. Agent cards are compact (name, status, current task, controls). Clicking a card fills the right detail panel (role, model, recent actions, config excerpt, token usage).
- **D-13:** `WebviewPanelSerializer` with `getState/setState`. Store active tab and selected agent. On restart, `deserializeWebviewPanel` restores panel with last-known data from SQLite.

### Dashboard Message Contracts
- **D-14:** Extend existing typed `postMessage` unions. `HostToWebviewMessage` adds: `dashboard:agentEvents`, `dashboard:agentUpdate`, `dashboard:summary`. `WebviewToHostMessage` adds: `agent:pause`, `agent:resume`, `agent:stop`, `dashboard:requestState`.

### Dashboard Styling
- **D-15:** VSCode CSS variables for native look. Plain CSS with custom properties. No UI toolkit (deprecated per locked constraints).

### Agent Controls
- **D-16:** Stop (CTRL-03): Send `SIGTERM` to the Claude Code process PID. Track PID via `child_process.spawn` (adapter launches Claude Code) or `ps` scan matching working directory.
- **D-17:** Pause/Resume (CTRL-01, CTRL-02): PreToolUse gate — when agent is "paused", the PreToolUse hook returns `{continue: false, decision: "block", reason: "Agent paused by HarnessTune operator"}`. Claude Code sees the block and waits. Resume clears the flag; next PreToolUse goes through. No SIGTSTP — avoids broken network connections and process corruption.
- **D-18:** Agent state model: `AgentControlState = 'running' | 'paused' | 'stopping' | 'stopped'`. `AgentSession` interface tracks `sessionId`, `workspaceId`, `pid?`, `controlState`, `pausedAt?`.
- **D-19:** Command Palette (CTRL-04): Three commands — `harnesstune.pauseAgent` ("HarnessTune: Pause Agent"), `harnesstune.resumeAgent` ("HarnessTune: Resume Agent"), `harnesstune.stopAgent` ("HarnessTune: Stop Agent"). Each shows a `QuickPick` list of eligible agents when no agent is selected from dashboard context.

### Claude's Discretion
- Exact SQLite table schema for agent events (must use sql.js per locked constraints)
- Memory queue implementation details (ring buffer vs array with flush threshold)
- Dashboard React component hierarchy and file organization
- Summary bar metric calculations and refresh interval
- Notification toast content and severity mapping
- Status bar badge update logic for error counting

</decisions>

<specifics>
## Specific Ideas

- PreToolUse gate for pause is preferred over SIGTSTP because it keeps the Claude Code process healthy — no broken network connections, Claude gets a clear signal about why it's blocked, resume is instant.
- Hook config injection must be idempotent — running connect twice should not duplicate entries.
- The "All Workspaces" tab aggregates metrics across all workspaces for a global health view.
- Agent cards should show inline control buttons (pause/resume/stop) that reflect current `AgentControlState`.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §Phase 2 — Phase goal, key deliverables, success criteria, research flags
- `.planning/REQUIREMENTS.md` — Requirements DASH-01–05, CTRL-01–04, CCAD-01–06, NOTF-01–03

### Locked architectural constraints
- `.planning/ROADMAP.md` §Key Architectural Constraints — sql.js (not better-sqlite3), no @vscode/webview-ui-toolkit, acquireVsCodeApi() once, retainContextWhenHidden only on terminal panel, absolute paths, RelativePattern watchers

### Phase 1 integration points
- `src/extension.ts` — Extension entry point with placeholder `harnesstune.showDashboard` command
- `src/types/messages.ts` — Existing `HostToWebviewMessage` and `WebviewToHostMessage` union types to extend
- `src/types/workspace.ts` — `WorkspaceRecord` and `IWorkspaceRegistry` interface
- `src/panels/SidebarViewProvider.ts` — Sidebar that will gain click-to-open-dashboard behavior
- `src/statusbar/StatusBarManager.ts` — Status bar to update with error badge from notifications

### Prior discuss-phase decisions
- `.planning/phases/02-claude-code-adapter-dashboard/02-DISCUSS-CHECKPOINT.json` — Raw decision capture from all 3 discussion areas

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WorkspaceRegistry` (src/registry/WorkspaceRegistry.ts): Provides workspace CRUD and `onDidChange` event — dashboard subscribes to this for workspace tab updates
- `SidebarViewProvider` (src/panels/SidebarViewProvider.ts): Demonstrates WebviewView pattern with React — dashboard WebviewPanel follows same structure but as a panel
- `StatusBarManager` (src/statusbar/StatusBarManager.ts): Already shows running agent count and error badge — hook into notification system for error count updates
- `SecretStore` (src/secrets/SecretStore.ts): API key storage pattern — may be needed if adapter requires authentication
- `vscodeApi.ts` (src/webview/sidebar/vscodeApi.ts): `acquireVsCodeApi()` once pattern — replicate for dashboard webview

### Established Patterns
- Typed `postMessage` contracts in `src/types/messages.ts` — extend with dashboard-specific message types
- React 18 with `createRoot` in webview entry points — dashboard follows same pattern
- esbuild dual-target build (CJS extension host + ESM webview) — dashboard webview gets its own ESM entry point
- Event-driven updates via `onDidChange` EventEmitter pattern — adapt for agent event propagation

### Integration Points
- `extension.ts` placeholder `harnesstune.showDashboard` command → replace with real DashboardPanel creation
- Sidebar workspace click → open/focus DashboardPanel with that workspace's tab active
- New `src/adapters/` directory for `ClaudeCodeHookAdapter` implementing `AgentBackendAdapter` interface
- New `src/server/` directory for embedded HTTP hook server
- New `src/database/` directory for sql.js SQLite event store
- `package.json` → register 3 new commands (pause/resume/stop), WebviewPanelSerializer, bump dependencies

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-claude-code-adapter-dashboard*
*Context gathered: 2026-04-16*
