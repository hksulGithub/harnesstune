# Phase 3: Agent Schematic (Live Topology) - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Interactive topology graph renders in a WebviewPanel, reconstructing the live agent hierarchy from Phase 2's hook event stream, with click-to-inspect and zoom/pan. Covers requirements SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-05, SCHM-06.

</domain>

<decisions>
## Implementation Decisions

### Graph Rendering Approach
- **D-01:** D3 layout math + React SVG rendering (Option C). D3 calculates node positions via `d3-hierarchy`; React owns the SVG tree. No `d3-selection`, `d3-transition`, or `d3-zoom` — only D3's math modules.
- **D-02:** React renders `<svg>` with `<g>` groups per node (React components with `onClick`), `<path>` per edge (React component), `<circle>` animated along edge path via SVG `<animateMotion>`.
- **D-03:** Zoom/pan implemented via React state `{ x, y, scale }` applied as SVG `<g transform={...}>` wrapper. `onWheel` for zoom, `onMouseDown`/`onMouseMove` for pan. ~40 lines, no d3-zoom dependency.
- **D-04:** NOT pure D3 SVG — avoids DOM ownership conflict with React. NOT React Flow — 150KB bundle overkill for read-only topology, limited edge animation, layout algorithm coupling.

### Layout Algorithm
- **D-05:** `d3-hierarchy` tree layout (~15KB). Claude Code's SubagentStart model is a strict tree — each subagent has exactly one parent via `parent_tool_use_id`. No DAG patterns exist.
- **D-06:** If DAG patterns emerge later, swap to `d3-dag` in one file — React rendering layer only consumes `{ x, y }` coordinates, not the layout engine. No preemptive abstraction layer.
- **D-07:** dagre rejected (unmaintained since 2021). elkjs rejected (400KB, compound node layout unnecessary). d3-dag deferred (solves a problem that doesn't exist in Claude Code's agent model).

### Hierarchy Reconstruction
- **D-08:** Node identity: `sessionId` (unique per agent session). `agentId` can collide across parallel instances of the same agent type. `AgentSession` already keys on `sessionId`.
- **D-09:** Add `parentToolUseId?: string` to `AgentEvent` interface. Extract from raw hook payload in `ClaudeCodeHookAdapter.normalizeEvent()`. Add `parent_tool_use_id TEXT` column to SQLite schema. Verify exact field name from real SubagentStart hook payloads during implementation.
- **D-10:** Topology reconstruction pipeline: `AgentEvent stream → topologyReducer (pure function) → { nodes: TopologyNode[], edges: Edge[] } → d3-hierarchy layout → { x, y } coordinates → React SVG render`.

### Edge Scope
- **D-11:** Edges represent agent→subagent relationships ONLY. No tool call nodes in the graph. Tool calls are detail, not topology — shown in `AgentDetailPanel` when clicking a node.
- **D-12:** Rationale: a multi-agent session can fire 50-100+ tool calls per agent. Putting those on the graph turns a clean 5-node tree into a 200-node hairball. The graph answers "what agents exist and how do they relate" — the detail panel answers "what is each agent doing."

### Node Lifecycle
- **D-13:** `SubagentStart` → add node (full opacity, status color). `SubagentStop` → mark completed (reduced opacity, dashed border, edge animation stops). `SessionEnd` → mark root completed (entire tree grays out).
- **D-14:** Completed nodes stay visible — never auto-removed. The tree structure is the historical record. Removing nodes causes layout reflow (remaining nodes jump positions), which is disorienting.
- **D-15:** Optional "Clear completed" button to remove finished session trees — UI polish, not structural. Deferred to implementation discretion.

### Panel Integration
- **D-16:** Separate `WebviewPanel` (not a tab within dashboard, not a dashboard split). Own editor tab, independent lifecycle, separate esbuild bundle. Users can drag topology tab side-by-side with dashboard via native VSCode layout.
- **D-17:** State persistence via `getState/setState`: `{ workspaceId, zoomLevel, panOffset, selectedNodeId }`. NOT `retainContextWhenHidden` (locked constraint).
- **D-18:** Reuse `AgentDetailPanel` — move from `src/webview/dashboard/components/` to `src/webview/shared/components/AgentDetailPanel.tsx`. Both dashboard and schematic import from shared. Same `AgentSession + AgentEvent[]` props.
- **D-19:** Schematic panel layout: toolbar (Fit to View, Zoom +/-, workspace selector) + graph/detail horizontal split. Graph stays visible when detail panel is open (SCHM-03 requirement). Click node → detail panel populates on the right.
- **D-20:** `WebviewPanelSerializer` registered for `harnesstune.schematic` viewType. Panel reopens with last-known state after VSCode restart.

### Dependencies
- **D-21:** Add `d3-hierarchy` (~15KB) as production dependency. Add `@types/d3-hierarchy` as dev dependency. No other D3 modules needed.
- **D-22:** New esbuild entry point: `src/webview/schematic/index.tsx` → `dist/webview/schematic.js` (ESM, browser target). Fourth webview bundle alongside sidebar, dashboard.

### Claude's Discretion
- Exact `TopologyNode` and `Edge` TypeScript interfaces (must include `sessionId`, `parentSessionId`, `status`, `x`, `y`)
- `topologyReducer` implementation details (event ordering, dedup, error handling)
- SVG node visual design (shape, size, colors, status indicators)
- Minimap implementation approach (SCHM-04 mentions minimap for large graphs)
- Toolbar component design and workspace selector behavior
- "Fit to view" algorithm (calculate bounding box → set viewBox)
- Edge path calculation (straight lines vs bezier curves)
- Animation timing for traveling dot on active edges

</decisions>

<specifics>
## Specific Ideas

- The `topologyReducer` should be a pure function: `(events: AgentEvent[]) → { nodes: TopologyNode[], edges: Edge[] }`. This makes it testable without any React or D3 dependencies.
- Start with `d3.tree()` layout with `nodeSize([80, 120])` for horizontal spacing. Top-down orientation (root at top, children below) matches how users think about orchestrator→subagent hierarchies.
- Edge animation: SVG `<animateMotion dur="1.5s" repeatCount="indefinite">` with a small `<circle r="3">` traveling along the edge `<path>`. Toggle via `isActive` prop — active edges animate, completed edges don't.
- Workspace selector in toolbar: dropdown matching dashboard's workspace tabs. Selecting a workspace filters the graph to show only that workspace's agent trees.
- The shared `AgentDetailPanel` extraction should be a clean move — the component already receives `session: AgentSession | null` and `events: AgentEvent[]` as props with no dashboard-specific dependencies.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §Phase 3 — Phase goal, key deliverables, success criteria, research flags
- `.planning/REQUIREMENTS.md` — Requirements SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-05, SCHM-06

### Locked architectural constraints
- `.planning/ROADMAP.md` §Key Architectural Constraints — D3.js over Mermaid, sql.js (not better-sqlite3), no @vscode/webview-ui-toolkit, acquireVsCodeApi() once, retainContextWhenHidden only on terminal panel, absolute paths, RelativePattern watchers

### Phase 2 integration points (built infrastructure this phase depends on)
- `src/types/agent.ts` — `AgentEvent`, `AgentSession`, `AgentControlState` types. Extend `AgentEvent` with `parentToolUseId`
- `src/types/messages.ts` — `HostToWebviewMessage` / `WebviewToHostMessage` unions. Add schematic-specific message types
- `src/database/AgentEventStore.ts` — SQLite event store. Add `parent_tool_use_id` column and hierarchy query method
- `src/adapters/ClaudeCodeHookAdapter.ts` — `normalizeEvent()` method. Extract `parentToolUseId` from raw payload
- `src/panels/DashboardPanel.ts` — WebviewPanel pattern to replicate for SchematicPanel
- `src/webview/dashboard/components/AgentDetailPanel.tsx` — Move to shared, reuse in schematic
- `src/webview/dashboard/components/ControlButtons.tsx` — Already shared-ready via props
- `src/server/HookServer.ts` — Event flow entry point (SubagentStart/SubagentStop events)
- `src/extension.ts` — Event routing. Add SchematicPanel event push alongside DashboardPanel push
- `esbuild.mjs` — Add fourth webview entry point for schematic bundle
- `package.json` — Add `harnesstune.schematic` serializer, `harnesstune.showSchematic` command, `d3-hierarchy` dependency

### Prior phase context
- `.planning/phases/02-claude-code-adapter-dashboard/02-CONTEXT.md` — Hook server, adapter, dashboard, controls decisions

</canonical_refs>

<deferred>
## Deferred Ideas

- **Tool call nodes in graph** — showing PreToolUse/PostToolUse as leaf nodes on the graph. Rejected for v1 (creates 200-node hairball). Potential v2 feature via ADVM-02 ("live event stream panel with cross-agent timeline").
- **DAG layout (d3-dag)** — unnecessary for Claude Code's strict tree model. Swap in one file if non-tree patterns emerge from future adapters.
- **Inline terminal in schematic** — embedding a terminal session within the schematic panel for direct agent interaction. Belongs to Phase 4 scope.

</deferred>

---

*Phase: 03-agent-schematic-live-topology*
*Context gathered: 2026-04-16*
