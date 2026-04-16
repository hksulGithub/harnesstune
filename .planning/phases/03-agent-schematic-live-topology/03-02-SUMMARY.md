---
phase: 03-agent-schematic-live-topology
plan: "02"
subsystem: ui
tags: [react, svg, d3-hierarchy, vscode-webview, topology, schematic]

requires:
  - phase: 03-01
    provides: [TopologyNode, TopologyEdge, TopologyState, buildTopology, AgentDetailPanel-shared, schematic message types]

provides:
  - SchematicPanel WebviewPanel host class with nonce CSP
  - React SVG component tree: App, Toolbar, GraphArea, TopologyNodeComponent, TopologyEdgeComponent, Minimap, WorkspaceSelector
  - schematic.css with VSCode CSS variable-based styling
  - Fourth esbuild entry point building dist/webview/schematic.js + dist/webview/schematic.css

affects: [03-03-PLAN.md]

tech-stack:
  added: []
  patterns:
    - DashboardPanel pattern replicated for SchematicPanel (viewType, currentPanel static, createOrShow, revive, nonce-CSP HTML)
    - acquireVsCodeApi() singleton in module scope per webview
    - React state + SVG transform for zoom/pan (no d3-zoom)
    - SVG animateMotion with mpath for traveling dot animation
    - fitToViewCounter integer trigger for parent-to-child fit-to-view signal
    - ResizeObserver on SVG element for live svgSize tracking in Minimap
    - prefers-reduced-motion check at component scope (no listener, stable value)

key-files:
  created:
    - src/panels/SchematicPanel.ts
    - src/webview/schematic/vscodeApi.ts
    - src/webview/schematic/index.tsx
    - src/webview/schematic/App.tsx
    - src/webview/schematic/components/Toolbar.tsx
    - src/webview/schematic/components/GraphArea.tsx
    - src/webview/schematic/components/TopologyNodeComponent.tsx
    - src/webview/schematic/components/TopologyEdgeComponent.tsx
    - src/webview/schematic/components/Minimap.tsx
    - src/webview/schematic/components/WorkspaceSelector.tsx
    - src/webview/schematic/styles/schematic.css
  modified:
    - src/panels/index.ts
    - esbuild.mjs

key-decisions:
  - "fitToViewCounter integer state in App.tsx triggers fit-to-view in GraphArea without prop drilling imperative handles or refs"
  - "SVG <title> child element for viewport rect tooltip in Minimap (not title attribute — not valid on SVGRectElement in React types)"
  - "Traveling dot static midpoint uses cubic bezier t=0.5 weighted formula for paused/reduced-motion cases"
  - "GraphArea passes svgSize via ResizeObserver to Minimap for accurate viewport indicator scaling"
  - "WorkspaceEntry interface defined locally in App.tsx and Toolbar.tsx to avoid cross-file coupling for a simple {id, name} shape"

patterns-established:
  - "SchematicPanel follows DashboardPanel 1:1 — same public API, same nonce-CSP pattern, viewType harnesstune.schematic, ViewColumn.Two"
  - "All schematic webview CSS uses VSCode CSS custom properties exclusively — no hardcoded hex values"
  - "Node status is communicated by color AND shape (dashed border, chip text) — never color alone per accessibility contract"

requirements-completed: [SCHM-01, SCHM-04, SCHM-05, SCHM-06]

duration: 6min
completed: 2026-04-17
---

# Phase 03 Plan 02: Schematic UI Summary

**SchematicPanel WebviewPanel host with full React SVG topology graph: D3-positioned 140x44 nodes, cubic bezier edges with SVG animateMotion traveling dot, zoom/pan/fit-to-view toolbar, workspace selector, accessibility-compliant keyboard navigation, and VSCode-variable CSS styling**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-17T00:24:59Z
- **Completed:** 2026-04-17T00:31:04Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- SchematicPanel.ts host class replicating DashboardPanel pattern with `harnesstune.schematic` viewType, ViewColumn.Two, `retainContextWhenHidden: false`, nonce-CSP HTML loading schematic.js + schematic.css
- Full React SVG component tree: App.tsx message handling for all schematic message types, Toolbar with zoom/fit/workspace controls, GraphArea with wheel zoom, mouse pan, keyboard bindings (F/+/-/0/Escape), fit-to-view bounding box algorithm
- TopologyNodeComponent: 140x44px rx=6 nodes with status colors, dashed border for stopped, error outer ring, RUNNING/PAUSED/DONE/ERROR chips, full keyboard accessibility (tabIndex, role=button, arrow navigation)
- TopologyEdgeComponent: cubic bezier paths with `<animateMotion dur="1.5s">` traveling dot on active edges, static midpoint dot for paused/reduced-motion, role=presentation aria-hidden
- Minimap appearing only when nodes.length > 5 with ResizeObserver-based viewport indicator
- Fourth esbuild entry point producing dist/webview/schematic.js + dist/webview/schematic.css

## Task Commits

1. **Task 1: SchematicPanel host class, esbuild config, vscodeApi, React entry point** — `d7ea9e8` (feat)
2. **Task 2: React SVG graph components, toolbar, minimap, schematic CSS** — `b2eb1c4` (feat)

## Files Created/Modified

- `src/panels/SchematicPanel.ts` — WebviewPanel host, `harnesstune.schematic` viewType, ViewColumn.Two, retainContextWhenHidden: false, nonce-CSP, schematic.js/css loading
- `src/panels/index.ts` — Added `export { SchematicPanel }`
- `src/webview/schematic/vscodeApi.ts` — acquireVsCodeApi() singleton for schematic webview
- `src/webview/schematic/index.tsx` — React 18 createRoot entry point
- `src/webview/schematic/App.tsx` — Root component: topology/selectedNode/selectedSession/selectedEvents/viewTransform state, message listener for all schematic message types, schematic:selectNode on node click, schematic:requestState on mount, vscode.getState/setState persistence, workspace filter, AgentDetailPanel with showControls={false}
- `src/webview/schematic/components/Toolbar.tsx` — role=toolbar, left group (Fit/+/zoom%/−), right group (WorkspaceSelector)
- `src/webview/schematic/components/WorkspaceSelector.tsx` — HTML select, All workspaces option, 20-char truncation, aria-label=Filter by workspace
- `src/webview/schematic/components/GraphArea.tsx` — SVG role=application, onWheel zoom 0.2-3.0, onMouseDown/Move/Up pan, keyboard bindings, fit-to-view algorithm, ResizeObserver for svgSize, empty state, Minimap when >5 nodes
- `src/webview/schematic/components/TopologyNodeComponent.tsx` — 140x44 rx=6 rect, status dot, truncated labels, status chip, error outer ring, tabIndex/role=button/aria-label, selected/hover via CSS classes
- `src/webview/schematic/components/TopologyEdgeComponent.tsx` — cubic bezier M/C path, animateMotion traveling dot, static dot for paused/reduced-motion, role=presentation aria-hidden
- `src/webview/schematic/components/Minimap.tsx` — role=img, scaled node rects by status color, viewport indicator rect with SVG title child, hidden when <=5 nodes
- `src/webview/schematic/styles/schematic.css` — .schematic-root/.toolbar/.graph-area/.schematic-detail, VSCode CSS variables throughout, grab/grabbing cursors, node hover/selected SVG states, minimap positioning, empty-state, detail panel sections
- `esbuild.mjs` — schematicConfig added (ESM browser, src/webview/schematic/index.tsx → dist/webview/schematic.js), added to both watch and build Promise.all arrays

## Decisions Made

- **fitToViewCounter trigger pattern:** App.tsx holds a `fitToViewCounter` integer state. The Toolbar's "Fit to View" button increments it. GraphArea useEffect watches it and calls `fitToView()` when it changes. This avoids useImperativeHandle/forwardRef complexity while keeping the fit-to-view signal clean.
- **SVG title child for minimap viewport tooltip:** React's SVGRectElement type does not include a `title` attribute. Used `<rect><title>Visible area</title></rect>` child element instead — the standard SVG approach.
- **Traveling dot midpoint:** Cubic bezier midpoint at t=0.5 computed as weighted sum of control points for the static dot shown on paused edges and when prefers-reduced-motion is active.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SVG rect title attribute type error in Minimap.tsx**
- **Found during:** Task 2 (Minimap component)
- **Issue:** TypeScript error TS2322: `title` property does not exist on `SVGProps<SVGRectElement>`. Plan specified a tooltip on the viewport indicator rect.
- **Fix:** Replaced `title="Visible area"` attribute on `<rect>` with `<title>Visible area</title>` child element — the correct SVG way to provide accessible descriptions on shapes.
- **Files modified:** src/webview/schematic/components/Minimap.tsx
- **Verification:** `npx tsc --noEmit -p tsconfig.webview.json` exits 0
- **Committed in:** b2eb1c4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Minimal. Tooltip semantics unchanged; SVG `<title>` child is equivalent to HTML `title` attribute for screen readers.

## Issues Encountered

None beyond the Minimap type error documented above.

## Self-Check

- [x] `src/panels/SchematicPanel.ts` exists and contains `harnesstune.schematic`, `retainContextWhenHidden: false`, `schematic.js`, `schematic.css`, `ViewColumn.Two`
- [x] `src/webview/schematic/App.tsx` contains `schematic:topologyUpdate`, `schematic:nodeDetail`, `schematic:selectNode`, `showControls={false}`, `session={selectedSession}`, `events={selectedEvents}`, `getState`, `setState`
- [x] `dist/webview/schematic.js` exists (1.0MB)
- [x] `dist/webview/schematic.css` exists (4.7KB)
- [x] `npx tsc --noEmit -p tsconfig.extension.json` exits 0
- [x] `npx tsc --noEmit -p tsconfig.webview.json` exits 0
- [x] `node esbuild.mjs` completes without errors
- [x] Commits d7ea9e8 and b2eb1c4 verified in git log

## Self-Check: PASSED

All key files present and verified. Both task commits confirmed. TypeScript clean on both configs. esbuild produces schematic.js + schematic.css.

## Next Phase Readiness

- SchematicPanel is ready for wiring into extension.ts in Plan 03 (extension integration)
- Plan 03 needs to register `harnesstune.showSchematic` command, `WebviewPanelSerializer` for `harnesstune.schematic`, and wire topology pushes from topologyReducer to SchematicPanel.postMessage
- No blockers

---
*Phase: 03-agent-schematic-live-topology*
*Completed: 2026-04-17*
