# Research Summary: HarnessTune

**Project:** HarnessTune — VSCode Extension for Agent Harness Engineering
**Domain:** IDE extension / multi-agent observability / developer tooling
**Researched:** 2026-04-16
**Confidence:** HIGH (core VSCode API + Claude Code hooks); MEDIUM (adapter ecosystem, visualization tradeoffs)

---

## Executive Summary

HarnessTune occupies a genuine whitespace in the 2026 tooling landscape. Every competing agent observability platform (LangSmith, AgentOps, Langfuse, Helicone) is a browser-based cloud dashboard requiring a separate account and infrastructure. None of them are embedded in the IDE, none reconstruct live agent topology, and none operate without a cloud dependency. HarnessTune's core proposition — real-time, topology-first, zero-infrastructure monitoring inside VSCode — is technically feasible and has no direct competitor. The research across all four areas confirms this is buildable with well-understood VSCode APIs and a clear integration path via Claude Code's hooks system.

The recommended build approach is: Claude Code HTTP hooks as the primary data source (they emit 24 lifecycle events including SubagentStart/SubagentStop, which are the backbone of topology reconstruction), a local HTTP server in the extension host to receive those hooks, a typed adapter layer to normalize events from multiple backends, and React-based WebviewPanels for the dashboard and schematic. The agent graph should use D3.js v7 with d3-force for live rendering (not Mermaid — Mermaid cannot dynamically add/remove nodes without full re-render and flicker, which disqualifies it for live topology). Internally, research converges on React Flow as an alternative worth evaluating for the schematic panel given its built-in drag, zoom, minimap, and edge routing.

The primary risks are: (1) extension memory pressure from multiple simultaneous WebviewPanels — each is a full browser iframe consuming 80–150MB; mitigate by lazy-creating panels and disposing them aggressively. (2) node-pty / native binary packaging if an embedded PTY terminal is required — defer this to v2 and use VSCode's native Pseudoterminal API for v1. (3) data model fragility if the internal event schema is built without alignment to OpenTelemetry GenAI semantic conventions — align from day one so HarnessTune can export to external tools later. All three risks are avoidable with deliberate architectural choices in Phase 1.

---

## Key Findings

### Stack Decisions

All four researchers converge on the same core stack. No conflicts.

**Extension host (Node.js):**
- **TypeScript** with separate `tsconfig.extension.json` (no DOM) and `tsconfig.webview.json` (with DOM) — mandatory, not optional, because extension host and webview are different runtimes
- **esbuild** for bundling, not webpack — 50x faster build times, critical for the dev loop; dual entry point: CJS for extension host, ESM per webview bundle
- **`sql.js`** for SQLite (NOT `better-sqlite3`) — `better-sqlite3` requires native C++ compiled against VSCode's specific Electron version; `sql.js` uses WebAssembly, zero compilation issues

**Webview UI (browser sandbox):**
- **React 18** via `webview-ui/` directory, one React app per panel type (dashboard, schematic, chat, sidebar)
- **D3.js v7 + d3-force + dagre** for the agent schematic — D3 supports reactive node/edge updates without full re-render; Mermaid does not
- **React Flow** as alternative to raw D3 for schematic — evaluate in Phase 2; higher-level API, built-in minimap and controls, MIT licensed (verify commercial terms for HarnessTune's distribution model)
- **VSCode CSS variables** for all theming — never hardcode colors; use `--vscode-sideBar-background`, `--vscode-list-activeSelectionBackground`, etc.
- No `@vscode/webview-ui-toolkit` — officially deprecated January 2025; use VSCode Elements (community-maintained) or plain CSS with VSCode variables

**Messaging:**
- **Typed message contracts** (`HostToWebviewMessage` / `WebviewToHostMessage` union types) with UUID correlation IDs for request/response pairs
- **`vscode-messenger`** (TypeFox) as drop-in RPC library rather than building the correlation layer from scratch

**State & persistence:**
- **`globalStorageUri`** (filesystem) for workspace registry JSON and `sql.js` SQLite database
- **`workspaceState`** (VSCode Memento) for active panel/selection state
- **`context.secrets`** for API keys — never `globalState`
- **`getState/setState` + `WebviewPanelSerializer`** for webview persistence across hide/show and VSCode restarts

**Integration:**
- **Claude Code HTTP hooks** — primary data intake; hooks POST to `localhost:PORT` on all 24 lifecycle events; auto-inject hook config into `~/.claude/settings.json` on adapter connect, remove on disconnect
- **OTel GenAI semantic conventions** — align internal `AgentEvent` schema to these from day one
- **`RelativePattern`** for all file watchers — string glob patterns only watch inside the current VSCode workspace folder; `RelativePattern` with absolute base path works anywhere

---

### Expected Features

**Must-have (table stakes — Phase 1):**
- Workspace registry: add/remove/list agent workspaces with sidebar list
- Status badges per agent (traffic light: running/idle/warning/error/unknown) — always pair color with icon, never color alone
- Agent detail panel: role, status, recent actions (last 5–10), config excerpt
- Pause/Resume/Stop controls per agent — safety requirement; without these users have no recourse for runaway agents
- Status bar summary (running count + error badge)
- Error notifications: toast for warnings/errors, status bar badge for informational events
- Command Palette integration: all actions reachable via `HarnessTune:` prefix
- File watcher pipeline: watch agent directories → debounce → refresh health display

**Should-have (Phase 2 differentiators):**
- Interactive agent schematic (D3/React Flow webview): live topology with node click-to-inspect, edge animation for message-in-flight, dagre hierarchical layout
- Live event stream panel (bottom panel area): timestamped cross-agent events, color-coded by type, filterable
- Sparklines in agent list rows (60–80px, 20–24px tall, trend-only, no axis labels)
- Budget/cost display per agent (wallet icon + running total + cap inline in agent header)
- Decision ledger / audit log per agent (searchable: what was done, why allowed, what it cost)
- Claude Code adapter: HTTP hook server + auto settings.json injection
- OpenClaw adapter: JSONL file tailing via `chokidar` or `fs.watch`

**Defer to v2+:**
- Embedded xterm.js PTY terminal in webview (requires `node-pty` native binaries — complex VSIX packaging; defer until explicitly required)
- Policy studio / guardrail editor (use config files initially)
- Anomaly detection with user-configurable thresholds (needs baseline data before meaningful detection)
- Paperclip adapter (polling-based, low priority)
- OpenCode ACP adapter (requires user to start OpenCode with ACP enabled)
- Mermaid "export as diagram" (static export only; not for live rendering)
- Multi-model selector in chat

---

### Architecture Approach

The extension has two runtimes that must never be conflated: the **extension host** (Node.js, full VSCode API access, runs the HTTP hook server and file watchers) and the **webview sandbox** (browser iframe, no Node.js, communicates only via `postMessage`). Every architectural decision follows from this boundary. The sidebar uses a `WebviewView` (always-on, registered via `registerWebviewViewProvider`) because the workspace list needs custom health indicators that TreeView cannot render. Each workspace opens a set of `WebviewPanel` instances in the editor area, managed in a `Map<workspaceId, WebviewPanel>` with `onDidDispose` cleanup. State flows one direction: extension host is source of truth; webviews hold display state only.

**Major components:**

1. **Extension Host Core** — activation, storage (JSON registry + sql.js SQLite), file watcher pipeline, HTTP hook server, adapter registry
2. **Adapter Layer** — one `AgentBackendAdapter` implementation per backend (ClaudeCodeHookAdapter, OpenClawAdapter, etc.); all normalize to the shared `AgentEvent` schema (OTel-aligned)
3. **Panel Manager** — manages lifecycle of `WebviewPanel` instances per workspace (dashboard, schematic, chat); handles `WebviewPanelSerializer` for cross-restart persistence
4. **Sidebar WebviewView** — always-visible workspace list with health indicators; acts as the persistent state hub so panels can be disposed and recreated cheaply
5. **Webview React Apps** — one per panel type; communicate with host via typed `postMessage`; persist UI state via `getState/setState`
6. **D3/React Flow Schematic** — runs entirely in webview; receives `AgentEvent` stream via postMessage; reconstructs topology from `SubagentStart/SubagentStop` + `parent_tool_use_id`

---

### Critical Pitfalls

1. **Calling `acquireVsCodeApi()` more than once per webview script** — throws on the second call. Store the return value in module scope immediately on script load. This is the single most common webview bug.

2. **Using `retainContextWhenHidden: true` on all panels** — each retained panel holds a full browser context in memory (80–150MB). With 3+ workspaces open this becomes visible memory pressure. Use `getState/setState` for data panels; only retain the chat/terminal panel where PTY reconnect is genuinely complex.

3. **`node-pty` in v1** — requires native C++ binaries compiled per platform (win32/darwin/linux, arm64/x64). Has bitten many extensions at VSIX publish time. Use VSCode's native `Pseudoterminal` API instead; defer embedded xterm.js to v2.

4. **Not registering `WebviewPanelSerializer`** — panels will not reopen after VSCode restart. Required activation event: `"onWebviewPanel:harnesstune.<panelType>"` in `package.json`. Known VSCode bug (#240207) means state sometimes persists without a serializer — do not rely on this; implement the serializer explicitly.

5. **Mermaid.js for live topology** — Mermaid cannot dynamically add/remove nodes without clearing the DOM and re-running `mermaid.init()`, causing flicker on every update. Click events have a known bug history. Its `securityLevel: 'loose'` mode (required for click handlers) introduces CSP concerns in the webview context. Use D3.js for live graph; use Mermaid only for static text export.

6. **Storing agent `rootPath` as a relative path** — VSCode opens in different working directories depending on how it's launched. Relative paths silently resolve to wrong locations. Always store absolute paths in the workspace registry.

7. **String glob patterns in FileSystemWatcher** — only watch paths inside the current VSCode workspace folder. Agent directories are typically outside the open workspace (`~/.claude/`, `/Users/...`). Always use `RelativePattern` with an absolute base path.

8. **`@vscode/webview-ui-toolkit`** — deprecated January 2025. Do not use. Switch to VSCode Elements or plain CSS with VSCode CSS variables.

---

## Implications for Roadmap

### Phase 1: Foundation — Registry, Watchers, Sidebar

**Rationale:** Everything else in HarnessTune depends on knowing which workspaces and agents exist. The workspace registry + file watcher pipeline + sidebar are the prerequisite for every subsequent panel and feature. WORKSPACE.md explicitly recommends this sequencing: "Registry first. Everything else depends on it."

**Delivers:**
- Extension scaffolding with esbuild dual-target build (extension host CJS + sidebar webview ESM)
- Workspace registry JSON schema and CRUD at `globalStorageUri`
- File watcher pipeline (RelativePattern → debounce → health refresh)
- Sidebar WebviewView with React: workspace list, status badges, agent tree
- Status bar item (running count + error badge)
- Command Palette registration (`HarnessTune:` prefix)
- `context.secrets` storage for API keys
- `workspaceState` persistence for active selection

**Addresses:** Agent list tree view, status badges, status bar summary, Command Palette integration (all UX must-haves)

**Avoids:** RetainContextWhenHidden overuse, relative path storage, missing WebviewPanelSerializer

**Research flag:** Standard patterns — skip research-phase. VSCode API is HIGH confidence; esbuild setup is well-documented.

---

### Phase 2: Claude Code Adapter + Dashboard Panel

**Rationale:** Claude Code is the first and deepest integration target. Its hooks system provides 24 lifecycle events via HTTP POST — this is the primary data source for all monitoring features. The dashboard panel gives users their first real view of agent health beyond the sidebar tree. Build the adapter layer and dashboard together so the data pipeline is testable end-to-end.

**Delivers:**
- Local HTTP server in extension host to receive Claude Code hook POSTs
- `ClaudeCodeHookAdapter` implementing `AgentBackendAdapter` interface
- Auto-inject / auto-remove hook config in `~/.claude/settings.json`
- Shared `AgentEvent` schema aligned with OTel GenAI semantic conventions
- `sql.js` SQLite database for token events and agent events tables
- Dashboard `WebviewPanel` with React: summary cards (total/running/error/cost), agent grid, agent detail panel
- Pause/Resume/Stop controls wired to Claude Code session management
- Agent detail panel: role, model, current task, recent actions, config excerpt
- `WebviewPanelSerializer` for dashboard persistence across restarts
- Toast notification logic: errors → toast; informational → status bar only

**Addresses:** Claude Code as first adapter, agent detail panel, pause/resume/stop controls, error notifications, budget display (basic), decision ledger foundation

**Avoids:** Full-page refresh for live updates (patch components via postMessage), modal dialogs for routine actions, toasts for every event

**Research flag:** The hooks auto-injection pattern (writing to `~/.claude/settings.json` programmatically) needs validation — confirm the settings.json schema accepts runtime additions without corrupting user config. Known bug in `claude-agent-sdk-python` (#573) where subprocess inherits `CLAUDECODE=1` env var; HTTP hooks avoid this but should be tested.

---

### Phase 3: Agent Schematic (Live Topology Graph)

**Rationale:** The schematic is HarnessTune's visual differentiator — no competitor offers IDE-embedded live topology. It depends on Phase 2's adapter pipeline (needs `SubagentStart/SubagentStop` events from the Claude Code adapter) and on Phase 1's panel manager infrastructure. Building it third allows the graph reconstruction algorithm to be tested against real hook data rather than mocks.

**Delivers:**
- Schematic `WebviewPanel` with React + D3.js v7 / d3-force / dagre
- Multi-agent topology reconstruction from `SubagentStart`, `SubagentStop`, `parent_tool_use_id`
- Node types: orchestrator, agent, tool call, data source, human checkpoint
- Live edge animation (traveling dot on message-in-flight)
- Click-to-inspect: clicking node opens agent detail in sidebar, diagram stays visible
- Hover tooltips: name, status, last action, response time (under 220px wide)
- Zoom/pan, "Fit to view" (Cmd+Shift+F), minimap for large graphs
- Layout toggle: dagre hierarchical (default) / force-directed (exploration mode)
- Schematic state persistence via `getState/setState`

**Addresses:** Interactive agent graph, live event stream (basic version), multi-agent flow visualization

**Avoids:** Mermaid for live rendering, D3 main-thread blocking on large graphs (use Web Worker for layout computation if graph exceeds 20 nodes)

**Research flag:** Needs research-phase for React Flow vs. raw D3 decision. React Flow's commercial licensing terms need verification before committing to it for HarnessTune's distribution model. Also evaluate `d3-dag` vs `dagre` for hierarchical layout — `dagre` is unmaintained (last commit 2021); `d3-dag` is the maintained replacement.

---

### Phase 4: Event Stream + Sparklines + Audit Log

**Rationale:** These features add depth to monitoring without requiring new infrastructure — they consume the same `AgentEvent` stream already established in Phase 2. Building them fourth means they can be developed against real data and with real agents running, making UX validation meaningful.

**Delivers:**
- Event stream panel in VSCode bottom Panel area: timestamped cross-agent events, color-coded, filterable by agent/event type
- Sparklines in agent list rows (D3 mini line charts, 60–80px wide, trend-only)
- Decision ledger: searchable per-agent audit log (what, why, cost, result)
- Anomaly display in dedicated Alerts view (tree view or webview table); status bar badge increment, not toasts
- Budget meter: wallet icon + running total + cap in agent header
- "Stale data" dimming: visually dim components with no update for >30s, show "last seen" timestamp

**Addresses:** Live event stream, sparklines, decision ledger/audit log, anomaly display, cost awareness

**Research flag:** Standard patterns — skip research-phase. Canvas-based rendering (reference: disler's implementation) is the highest-performance option for high-frequency events; evaluate whether the React-based event stream meets performance requirements or needs a canvas fallback.

---

### Phase 5: Additional Adapters (OpenClaw, Workspace Scaffolding)

**Rationale:** Once the core monitoring loop works for Claude Code, adding more adapters is incremental. OpenClaw is the second-highest priority adapter (JSONL tailing, no API keys needed, low friction). Workspace scaffolding (template-based new-workspace creation) is a quality-of-life feature that requires the registry to be stable first.

**Delivers:**
- `OpenClawAdapter`: tail `~/.openclaw/agents/<agentId>/sessions/*.jsonl` via `chokidar`; parse nd-JSON incrementally
- Workspace scaffolding: template-based creation of `CLAUDE.md`, `.claude/settings.json`, `context/`, `work-log/` directories
- Template variables: `{{AGENT_NAME}}`, `{{AGENT_ROLE}}`, `{{CREATED_DATE}}`, `{{MODEL}}`
- Post-scaffold validation: verify all files created, register workspace, add FileSystemWatcher, open dashboard panel
- `WorkspaceRecord.tags` and `archived` field for workspace management

**Addresses:** Multi-backend normalization, workspace templates, agent identity convention (named agents vs. parallel instances)

**Research flag:** Agent identity vs. instance — if HarnessTune must handle multiple parallel instances of the same agent type, the tree view and graph need a naming/grouping convention. Define this before Phase 5 scaffolding; it affects the `AgentRecord.id` schema.

---

### Phase 6: Embedded Terminal / Chat Command Surface

**Rationale:** Deferred to last because it has the highest implementation complexity and the least dependency from other phases. Use VSCode's native `Pseudoterminal` API (not node-pty) for v1. The chat panel is not a coding assistant — it is a command-and-control surface. Design the UX accordingly: command-console feel, structured output rendering (JSON/tables), persistent session context per agent.

**Delivers:**
- Pseudoterminal per workspace (`Agent: <workspace-name>`) via VSCode native API
- Bash integration: `terminal.shellIntegration.executeCommand()` and `onDidEndTerminalShellExecution` for tracking agent task outcomes
- Chat/command panel WebviewView: slash commands (`/pause`, `/log`, `/config`), streaming token output, structured output rendering
- `retainContextWhenHidden: true` for chat panel only (PTY reconnect complexity justifies the memory cost)
- Keybindings: `Cmd+Shift+H` (open sidebar), `Cmd+.` (pause agent), `Cmd+L` (open agent log)

**Addresses:** Embedded terminal chat, per-agent command surface, keyboard accessibility

**Avoids:** node-pty in v1, wizard flows inside webview, modal dialogs for chat actions

**Research flag:** If users require the terminal to appear inline within the schematic panel (not in the VSCode panel area), this requires Approach B (xterm.js + node-pty). That is a v2 decision requiring explicit user research to justify the packaging complexity.

---

### Phase Ordering Rationale

- Phase 1 before everything: the workspace registry is the shared data model; panels, adapters, and watchers all depend on it
- Phase 2 before Phase 3: the schematic needs real event data to reconstruct topology; building the schematic against mocks risks designing for the wrong data shape
- Phase 4 after Phase 2: event stream and sparklines consume the same pipeline; build the pipeline first, enrich visualization second
- Phase 5 after Phase 2: additional adapters are incremental once the adapter interface is proven with Claude Code
- Phase 6 last: highest complexity, lowest cross-dependency, can be deferred without blocking any other phase

---

### Research Flags

**Needs research-phase during planning:**
- Phase 3: React Flow vs. raw D3 commercial licensing; `dagre` (unmaintained) vs `d3-dag` for hierarchical layout
- Phase 2: Hook auto-injection safety — test that programmatic writes to `~/.claude/settings.json` do not corrupt user config; validate HTTP hook behavior under `CLAUDECODE=1` subprocess env var bug
- Phase 5: Agent identity vs. parallel instance naming convention — must be defined before registry schema is finalized

**Standard patterns (skip research-phase):**
- Phase 1: esbuild dual-target, WebviewView sidebar, RelativePattern watchers — all HIGH confidence, well-documented
- Phase 4: Event stream and sparklines — consume existing pipeline; no novel architecture
- Phase 6: Pseudoterminal API — HIGH confidence, official docs, used by multiple major extensions

---

## Conflicts and Tensions Between Researchers

| Topic | TECHNICAL.md | ECOSYSTEM.md | UX.md | Resolution |
|-------|-------------|--------------|-------|------------|
| Sidebar: TreeView vs WebviewView | WebviewView (custom health indicators exceed TreeView) | Not addressed | TreeView recommended for agent list | **WebviewView wins** — UX.md's TreeView recommendation does not account for sparklines and custom badge shapes; TECHNICAL.md and WORKSPACE.md both recommend WebviewView for the sidebar once health indicators are in scope |
| Schematic library | Mermaid for v1, D3 for v2 | D3 recommended (Mermaid flicker/click bug disqualifies it) | React Flow / Cytoscape.js | **D3 or React Flow directly** — ECOSYSTEM.md's detailed analysis of Mermaid's re-render limitations overrides TECHNICAL.md's conservative v1 recommendation; evaluate React Flow in Phase 3 planning |
| Terminal approach | Native Pseudoterminal for v1 | Not addressed | Persistent sidebar chat panel | **Native Pseudoterminal** confirmed — both researchers agree on deferring node-pty |
| Panel sidebar persistence | getState/setState + Serializer | Not addressed | workspaceState for active workspace | **Both**: webview getState/setState for UI state; workspaceState for active selection — not in conflict, different layers |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| VSCode Extension API (layout, webviews, panels, watchers) | HIGH | Official docs; confirmed by Cline/other production extensions |
| Claude Code hooks integration | HIGH | Official hooks documentation; 24 events verified |
| Build tooling (esbuild, tsconfig split) | HIGH | Verified benchmarks; pattern used by multiple extensions |
| State persistence (getState/setState, Serializer) | HIGH | Official docs; known bug (#240207) documented and mitigated |
| D3.js for live schematic | HIGH | D3 data binding is the right fit; specific implementation detail (dagre vs d3-dag) needs validation |
| sql.js vs better-sqlite3 | MEDIUM | Community consensus; native module issues confirmed by multiple reports but not officially documented |
| Adapter ecosystem (OpenClaw, Paperclip, OpenCode) | MEDIUM | Architectures inferred from changelogs and docs; internal event formats not fully documented |
| React Flow licensing | MEDIUM | MIT for open source; commercial terms need verification for HarnessTune's distribution model |
| Agent identity / parallel instances | LOW | No established convention; HarnessTune-specific design decision needed |
| OTel GenAI semantic conventions adoption timeline | LOW | Direction is clear; specific convention stability for 2026 tools needs monitoring |

**Overall confidence: HIGH** — the core VSCode extension architecture is well-understood and the Claude Code hooks system is well-documented. The main uncertainties are ecosystem-level (adapter internals, library licensing) and product-level (agent identity convention), neither of which blocks Phase 1 or 2.

### Gaps to Address

- **React Flow commercial licensing**: Confirm before committing to it in Phase 3. If commercial license is required, use D3.js directly.
- **`dagre` maintainability**: Last commit 2021. Evaluate `d3-dag` (maintained) or `elkjs` (ELK layout engine, actively maintained, used by Eclipse and VSCode itself for diagram layout) as the hierarchical layout algorithm.
- **Claude Code settings.json write safety**: Before Phase 2, test that auto-injecting hook config into `~/.claude/settings.json` does not clobber existing user config. Use JSON merge (not overwrite); add a schema validation step.
- **Agent identity convention**: Define before Phase 5 registry schema is finalized. If parallel instances are possible (multiple Ethans running), the `AgentRecord.id` format and graph node identity must account for it.
- **AG-UI / A2UI protocol monitoring**: Microsoft and Google are developing agent-to-UI communication protocols. Monitor; may affect event stream architecture in Phase 4.

---

## Sources

### Primary (HIGH confidence)
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VSCode UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)
- [VSCode Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VSCode Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VSCode Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Claude Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [VSCode Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)
- [IBM Carbon Design System — Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [React Flow](https://codingcops.com/react-flow/)

### Secondary (MEDIUM confidence)
- [Cline Extension WebviewProvider Architecture (DeepWiki)](https://deepwiki.com/cline/cline/2.4-webviewprovider)
- [vscode-messenger RPC library — TypeFox](https://github.com/TypeFox/vscode-messenger)
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [Langfuse Trace Graph View (Feb 2025)](https://langfuse.com/changelog/2025-02-14-trace-graph-view)
- [AgentOps Dashboard Documentation](https://docs.agentops.ai/v1/usage/dashboard-info)
- [OpenTelemetry AI Agent Observability (2025)](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [VSCode Agent Observability Issue #293225](https://github.com/microsoft/vscode/issues/293225)
- [better-sqlite3 vs sql.js — PkgPulse 2026](https://www.pkgpulse.com/blog/better-sqlite3-vs-libsql-vs-sql-js-sqlite-nodejs-2026)
- [cmux GitHub](https://github.com/manaflow-ai/cmux)
- [Paperclip GitHub](https://github.com/paperclipai/paperclip)
- [OpenClaw Architecture (ppaolo Substack)](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [Adapter Pattern in TypeScript (Refactoring Guru)](https://refactoring.guru/design-patterns/adapter/typescript/example)
- [Smashing Magazine — Real-Time Dashboard UX](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/)
- [Cambridge Intelligence — Graph Visualization UX](https://cambridge-intelligence.com/graph-visualization-ux-how-to-avoid-wrecking-your-graph-visualization/)
- [esbuild for VSCode — datho7561](http://datho7561.dev/blog/vscode-webpack-to-esbuild/)
- [VSCode Copilot Chat Agent Monitoring](https://github.com/microsoft/vscode-copilot-chat/blob/main/docs/monitoring/agent_monitoring.md)

### Tertiary (LOW confidence / needs validation)
- [Paperclip Review 2026](https://vibecoding.app/blog/paperclip-review) — Paperclip internal API surface not officially documented
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/) — ACP server monitoring surface inferred, not confirmed
- [Claude Code Hooks Production Patterns (Pixelmojo)](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns) — settings.json auto-injection safety unconfirmed
- AG-UI / A2UI protocol — mentioned in UX research; specification not yet stable

---

*Research completed: 2026-04-16*
*Ready for roadmap: yes*
