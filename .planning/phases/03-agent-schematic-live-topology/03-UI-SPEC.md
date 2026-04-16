---
phase: 3
slug: agent-schematic-live-topology
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-16
---

# Phase 3 — UI Design Contract: Agent Schematic (Live Topology)

> Visual and interaction contract for the schematic WebviewPanel. Covers SCHM-01 through SCHM-06.
> Generated as design input for plan-phase. All implementors must treat this as a locked contract.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (plain CSS + CSS variables) |
| Preset | not applicable |
| Component library | none — plain React + SVG |
| Icon library | Unicode characters only (no codicons in webview — established in Phase 2 execution) |
| Font | `var(--vscode-font-family)` — inherits from VSCode host |

**Constraint:** `@vscode/webview-ui-toolkit` is banned (deprecated January 2025). All styling uses VSCode CSS custom properties only, matching the Phase 2 `dashboard.css` approach exactly.

---

## Spacing Scale

All values are multiples of 4. Matches Phase 2 `dashboard.css` conventions.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-label gap, status dot margins, edge dot radius margin |
| sm | 8px | Node internal padding, toolbar button gap, detail section spacing |
| md | 12px | Node label padding (horizontal), toolbar horizontal padding |
| lg | 16px | Detail panel content padding, section `margin-bottom`, summary bar padding |
| xl | 24px | Graph area minimum internal padding from SVG edges |
| 2xl | 32px | Empty state vertical padding |
| 3xl | 48px | Minimap offset from graph edge |

### Component-Specific Spacing

| Component | Property | Value | Rationale |
|-----------|----------|-------|-----------|
| Toolbar | height | 36px | Matches `tab-bar` height (35px) + 1px border = 36px row |
| Toolbar | padding (horizontal) | 12px | Matches `.tab` horizontal padding |
| Toolbar | button gap | 4px | Matches `.agent-card .controls` gap |
| Toolbar button | min-width / min-height | 28px / 28px | Larger than Phase 2's 22px — graph context requires bigger tap target |
| Toolbar button | padding | 4px 8px | Labeled buttons need horizontal text padding |
| Node | width | 140px | Fixed. Wide enough for 18-char session IDs truncated |
| Node | height | 44px | Fixed. Two-line content: name row + role row |
| Node | internal padding | 8px | sm token |
| Node | border-radius | 6px | Slightly more rounded than Phase 2 card corners (4px) |
| Node status indicator | width / height | 8px / 8px | Matches `.status-dot` size from `dashboard.css` |
| Edge | stroke-width | 1.5px | Thin enough to not crowd the graph |
| Traveling dot | radius | 3px | Per D-02 decision in 03-CONTEXT.md |
| Detail panel | width | 300px (min) | Fixed right side panel; never less than 300px |
| Detail panel | padding | 16px | Matches `.detail-panel` padding from `dashboard.css` |
| Graph/detail split | graph flex | 1 (fills remaining) | Detail panel is fixed 300px; graph takes the rest |
| Minimap | width / height | 120px / 80px | Bottom-right corner; small enough to not obstruct graph |
| Minimap | offset from corner | 12px | sm token |

Exceptions: Node `width` (140px) and `height` (44px) are fixed pixel values outside the 4px scale — required by `d3.tree()` layout algorithm's `nodeSize([w, h])` parameter (D-05).

---

## Typography

All font sizes match the Phase 2 `dashboard.css` scale. No new type sizes are introduced.

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Body / default | 13px | 400 | 1.4 | Node role label, detail panel body text, toolbar labels |
| Label / secondary | 11px | 400 | 1.3 | Node session ID (truncated), detail panel `.key` cells, timestamp text, minimap labels |
| Heading | 13px | 600 | 1.2 | Node agent name (primary line), detail panel `h3`, toolbar section labels |
| Status chip | 11px | 600 | 1.0 | Status text inside node status badge (RUNNING / PAUSED / STOPPED / ERROR) |

### Node Label Truncation

- Primary line (agent name / role): truncate at 18 characters with `…` suffix. Overflow hidden, no wrapping.
- Secondary line (session ID): show first 8 characters of `sessionId`, format `sess:a1b2c3d4`. Always 11px, muted.

### Toolbar Text

- Workspace selector label: 13px, weight 400. Dropdown uses `var(--vscode-dropdown-foreground)`.
- Zoom level readout (e.g., `100%`): 11px, weight 400, `var(--vscode-descriptionForeground)`.

---

## Color

**Rule:** All colors use VSCode CSS custom properties. No hardcoded hex values in production CSS. This ensures automatic light/dark/high-contrast theme support with zero extra work.

### Primary Color Roles

| Role | VSCode Variable | Usage |
|------|-----------------|-------|
| Dominant (60%) — background | `var(--vscode-editor-background)` | Graph area background, schematic panel root |
| Secondary (30%) — surfaces | `var(--vscode-sideBar-background)` | Toolbar background, minimap background, detail panel background |
| Border / separator | `var(--vscode-widget-border)` | Node border (default), toolbar bottom border, detail panel left border |
| Foreground | `var(--vscode-foreground)` | Node primary label, toolbar text, detail panel text |
| Muted foreground | `var(--vscode-descriptionForeground)` | Node secondary label (session ID), toolbar zoom readout, minimap placeholder text |
| Focus ring | `var(--vscode-focusBorder)` | Focus indicator on all keyboard-focused interactive elements |
| Selection background | `var(--vscode-list-activeSelectionBackground)` | Selected node highlight fill |
| Selection foreground | `var(--vscode-list-activeSelectionForeground)` | Text inside selected node |
| Hover background | `var(--vscode-list-hoverBackground)` | Node hover state, toolbar button hover |
| Toolbar button active | `var(--vscode-toolbar-activeBackground)` | Toolbar button `:active` state |
| Badge background | `var(--vscode-badge-background)` | Status chip background (for RUNNING badge) |
| Badge foreground | `var(--vscode-badge-foreground)` | Status chip text |
| Error | `var(--vscode-errorForeground)` | Error status node border, error status dot |
| Code block background | `var(--vscode-textCodeBlock-background)` | Config excerpt `<pre>` block in detail panel |
| Progress bar | `var(--vscode-progressBar-background)` | Token bar fill in detail panel |

### Node Status Colors

Each status maps to a VSCode variable. Status is indicated by BOTH color AND shape/pattern (accessibility requirement — never color alone, per SIDE-02 precedent).

| Status | Color Variable | Shape / Pattern Modifier | Opacity | Edge Animation |
|--------|---------------|--------------------------|---------|----------------|
| running | `var(--vscode-terminal-ansiGreen)` | Solid border, full opacity | 1.0 | Traveling dot active |
| paused | `var(--vscode-terminal-ansiYellow)` | Solid border, full opacity | 1.0 | Traveling dot paused (dot frozen at midpoint) |
| stopped | `var(--vscode-descriptionForeground)` | Dashed border (`stroke-dasharray: 4 3`), reduced opacity | 0.5 | No animation |
| error | `var(--vscode-errorForeground)` | Double border (SVG `filter` or outer ring rect), full opacity | 1.0 | Traveling dot stopped |

The status color is applied to:
1. The node's border (`stroke` on the `<rect>`)
2. The 8px status dot inside the node (top-left corner)
3. The edge's `stroke` originating from that node (running = green, paused = yellow, stopped = muted, error = red)

### Completed Node State (D-13, D-14)

When `SubagentStop` fires, the node transitions to `stopped` state:
- Node opacity drops to 0.5
- Border becomes dashed (`stroke-dasharray: 4 3`)
- Edge animation stops
- Color: `var(--vscode-descriptionForeground)` — the node grays out relative to active nodes

When `SessionEnd` fires for the root node, the entire tree grays out (all nodes and edges set to `stopped` appearance).

### Edge Colors

| Edge State | Color Variable | Stroke Dash | Dot |
|------------|---------------|-------------|-----|
| Active (child running) | `var(--vscode-terminal-ansiGreen)` | solid | traveling `<circle r="3">` |
| Paused (child paused) | `var(--vscode-terminal-ansiYellow)` | solid | dot frozen at 50% |
| Completed (child stopped) | `var(--vscode-descriptionForeground)` | `4 3` dashed | none |
| Error (child errored) | `var(--vscode-errorForeground)` | solid | none |

### Accent Reserved For

`var(--vscode-focusBorder)` (accent) is reserved for: focus rings on keyboard-navigated nodes, toolbar buttons, and the detail panel close button. Never used for decorative purposes.

---

## Components

### 1. Schematic Panel Root Layout

```
┌──────────────────────────────────────────────────────┐
│  TOOLBAR (36px height, full width)                   │
├──────────────────────────────────────────────────────┤
│                              │                       │
│   GRAPH AREA (SVG, flex:1)   │  DETAIL PANEL (300px) │
│                              │                       │
│   [minimap: bottom-right]    │                       │
└──────────────────────────────────────────────────────┘
```

- Root: `display: flex; flex-direction: column; height: 100vh; background: var(--vscode-editor-background)`
- Toolbar: `flex-shrink: 0; height: 36px`
- Body row: `display: flex; flex: 1; overflow: hidden`
- Graph area: `flex: 1; position: relative; overflow: hidden`
- Detail panel: `width: 300px; min-width: 300px; flex-shrink: 0; border-left: 1px solid var(--vscode-widget-border); overflow-y: auto; background: var(--vscode-sideBar-background)`
- Detail panel is always mounted (never unmounted); when no node is selected, it shows an empty state

### 2. Toolbar

Layout: left group | spacer | right group

**Left group (in order):**
1. "Fit to View" button — label: `⊡ Fit` (unicode square + text)
2. "Zoom in" button — label: `+`
3. Zoom level readout — non-interactive text, e.g., `100%`
4. "Zoom out" button — label: `−`

**Right group:**
5. Workspace selector — `<select>` element showing workspace name. Filters graph to selected workspace. Styled via `var(--vscode-dropdown-*)` variables.

Toolbar button spec:
- `background: transparent`
- `border: none`
- `min-width: 28px; min-height: 28px`
- `padding: 4px 8px`
- `border-radius: 3px`
- `font-size: 13px`
- Hover: `background: var(--vscode-list-hoverBackground)`
- Active: `background: var(--vscode-toolbar-activeBackground)`
- Focus: `outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px`

### 3. Graph Area (SVG)

- `<svg width="100%" height="100%">` with a `<g class="viewport">` applying `transform={translate(x,y) scale(s)}`
- Zoom range: 0.2 (20%) to 3.0 (300%). Default: 1.0.
- Pan: `onMouseDown`/`onMouseMove` on the SVG root captures drag deltas. Cursor: `grab` (default), `grabbing` (dragging).
- `onWheel` on SVG: `deltaY > 0` zooms out, `deltaY < 0` zooms in. Step: multiply scale by 1.1 per wheel tick.
- Keyboard zoom: `+`/`=` zoom in, `-` zoom out, `0` resets to 100%.

**Node rendering (per `TopologyNode`):**

```
┌─────────────────────────────────────────┐   ← <rect> 140×44, rx=6
│ ● Agent Name (truncated to 18 chars)    │   ← 8px dot + 13px bold label
│   sess:a1b2c3d4              [RUNNING]  │   ← 11px session ID + 11px status chip
└─────────────────────────────────────────┘
```

SVG structure per node:
```xml
<g class="node" data-session-id="{sessionId}" tabIndex="0" role="button"
   aria-label="{agentName}, {status}, click to inspect">
  <rect width="140" height="44" rx="6"
        fill="var(--vscode-editor-background)"
        stroke="{statusColor}" stroke-width="1.5"
        stroke-dasharray="{dashedIfCompleted}" />
  <circle cx="16" cy="22" r="4" fill="{statusColor}" />
  <text x="28" y="18" font-size="13" font-weight="600"
        fill="var(--vscode-foreground)">{agentName}</text>
  <text x="28" y="34" font-size="11"
        fill="var(--vscode-descriptionForeground)">sess:{sessionId.slice(0,8)}</text>
  <rect class="status-chip" x="88" y="28" width="44" height="12" rx="6"
        fill="var(--vscode-badge-background)" />
  <text x="110" y="38" font-size="11" font-weight="600" text-anchor="middle"
        fill="var(--vscode-badge-foreground)">{STATUS}</text>
</g>
```

Selected node: apply `fill="var(--vscode-list-activeSelectionBackground)"` to the `<rect>`. Text switches to `var(--vscode-list-activeSelectionForeground)`.

Hover state: `fill="var(--vscode-list-hoverBackground)"` on `<rect>`.

**Edge rendering (per `Edge`):**

- `<path>` using cubic bezier: control points offset 60px vertically from source/target midpoints. This gives smooth S-curves that visually communicate hierarchy.
- `stroke-width: 1.5`, `fill: none`
- For active edges, append `<animateMotion dur="1.5s" repeatCount="indefinite">` with `<mpath xlink:href="#edge-{id}"/>` and a `<circle r="3" fill="{edgeColor}" />` child.
- `repeatCount="indefinite"` only when `isActive === true`. When paused or stopped, `repeatCount="0"` (dot disappears or is frozen).

**Layout parameters (d3.tree):**
- `nodeSize([160, 80])` — 160px horizontal spacing (node width 140 + 20px gap), 80px vertical spacing (node height 44 + 36px gap)
- Top-down orientation: root at top, children below. `x` maps to horizontal position, `y` maps to vertical position (standard `d3.tree()` default with `nodeSize`).

### 4. Minimap

- Positioned: `position: absolute; bottom: 12px; right: 12px`
- Size: 120px × 80px
- Background: `var(--vscode-sideBar-background)`, border: `1px solid var(--vscode-widget-border)`, border-radius: 4px
- Renders a simplified scaled-down replica of the graph using small `<rect>` elements (4px × 3px per node)
- Viewport indicator: a semi-transparent `<rect>` showing the current visible area within the full graph bounds
- Node colors in minimap match their status colors (same VSCode variable)
- Not interactive in v1 (no click-to-navigate). It is display-only.
- Hidden when graph has 5 or fewer nodes (too small to need a minimap).

### 5. Detail Panel

Reuses `AgentDetailPanel` component, moved from `src/webview/dashboard/components/` to `src/webview/shared/components/AgentDetailPanel.tsx` (per D-18). The panel layout and internal spacing is identical to Phase 2.

The only schematic-specific modification: the detail panel does not receive `ControlButtons` in its header in Phase 3 v1. Control buttons are a Phase 2 dashboard concern. The schematic detail panel is read-only in Phase 3.

Empty state (no node selected):
- Centered vertically in the 300px panel
- Heading: "Select an agent" (13px, weight 600, `var(--vscode-foreground)`)
- Body: "Click any node in the graph to inspect its status and recent actions." (13px, `var(--vscode-descriptionForeground)`)

### 6. Workspace Selector

- HTML `<select>` element in the toolbar right group
- Option list: all registered workspaces by name, plus "All workspaces" as the first option
- Selecting a workspace filters the graph: only agent trees from that workspace are rendered; others are hidden (not removed from state)
- Width: 160px max, truncates long workspace names
- Styled via: `background: var(--vscode-dropdown-background)`, `color: var(--vscode-dropdown-foreground)`, `border: 1px solid var(--vscode-dropdown-border)`, `border-radius: 3px`, `padding: 2px 4px`, `font-size: 13px`

---

## Copywriting Contract

### Toolbar Labels

| Element | Copy |
|---------|------|
| Fit to view button | `⊡ Fit` |
| Zoom in button | `+` |
| Zoom out button | `−` |
| Zoom level readout | `{N}%` (e.g., `100%`, `75%`, `200%`) |
| Workspace selector — all option | `All workspaces` |
| Workspace selector — specific | `{workspaceName}` (truncated to 20 chars with `…`) |

### Node Labels

| Element | Copy |
|---------|------|
| Node primary label | `{agentRole}` if defined, else `Agent` |
| Node secondary label | `sess:{sessionId.slice(0, 8)}` |
| Status chip — running | `RUNNING` |
| Status chip — paused | `PAUSED` |
| Status chip — stopped | `DONE` (not "STOPPED" — conveys completion, not failure) |
| Status chip — error | `ERROR` |

### Empty States

| Context | Heading | Body |
|---------|---------|------|
| Graph — no sessions at all | `No agents running` | `Start a Claude Code session to see the agent hierarchy appear here.` |
| Graph — workspace selected, no agents in that workspace | `No agents in this workspace` | `Switch to "All workspaces" or start an agent session in {workspaceName}.` |
| Detail panel — no node selected | `Select an agent` | `Click any node in the graph to inspect its status and recent actions.` |

### Tooltips (title attributes)

| Element | Tooltip Copy |
|---------|-------------|
| Fit to view button | `Fit graph to view (F)` |
| Zoom in button | `Zoom in (+)` |
| Zoom out button | `Zoom out (−)` |
| Zoom level readout | `Current zoom level. Scroll to zoom.` |
| Node (full name if truncated) | `{agentRole} — {sessionId}` |
| Active edge traveling dot | no tooltip (animation element, not interactive) |
| Minimap viewport rect | `Visible area` |

### Error States

| Context | Copy |
|---------|------|
| Topology reconstruction failure | `Failed to build graph — invalid event data.` (shown as empty-state body text; heading: `Graph unavailable`) |
| State restore failure (getState returns null) | Silent — show empty graph, no error message. User will see the graph repopulate as events arrive. |

---

## Accessibility

### Keyboard Navigation

The SVG graph is not natively keyboard-navigable. The following contract makes it fully keyboard-operable.

**Focus model:**
- Each `<g class="node">` receives `tabIndex="0"` and `role="button"`
- Tab order follows the `d3-hierarchy` tree traversal order (breadth-first, left to right within each depth level)
- The SVG root `<svg>` receives `role="application"` and `aria-label="Agent topology graph"`

**Key bindings on the SVG root (when graph has focus):**

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in by one step (1.1×) |
| `−` | Zoom out by one step (1/1.1×) |
| `0` | Reset zoom to 100% |
| `F` | Fit to view |
| `Escape` | Deselect current node, collapse detail panel to empty state |

**Key bindings on a focused node `<g>`:**

| Key | Action |
|-----|--------|
| `Enter` or `Space` | Select node — populate detail panel |
| `Arrow keys` | Move focus to adjacent node: Up = parent, Down = first child, Left = previous sibling, Right = next sibling |
| `Tab` | Move to next node in tab order (breadth-first) |
| `Shift+Tab` | Move to previous node in tab order |

### Focus Indicators

All focusable elements use `outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px` — consistent with Phase 2 `dashboard.css` global rule.

For SVG nodes, the focus indicator is rendered as an additional `<rect>` element overlaid on the node with `stroke="var(--vscode-focusBorder)"`, `stroke-width="2"`, `fill="none"`, `rx="6"`, matching the node dimensions (140×44). This SVG-native approach is more reliable than CSS `outline` on SVG elements across browsers.

### Screen Reader Labels

| Element | ARIA Label Pattern |
|---------|-------------------|
| SVG root | `role="application" aria-label="Agent topology graph"` |
| Node | `role="button" aria-label="{agentName}, {status}, session {sessionId.slice(0,8)}, click to inspect"` |
| Node (selected) | Add `aria-pressed="true"` |
| Node (completed) | Add `, completed` to aria-label suffix |
| Edge | `role="presentation" aria-hidden="true"` — edges are visual decorations, not interactive |
| Traveling dot | `aria-hidden="true"` — purely visual animation |
| Minimap | `role="img" aria-label="Graph minimap, showing {N} agents"` |
| Toolbar | `role="toolbar" aria-label="Graph controls"` |
| Fit to view button | `aria-label="Fit graph to view"` |
| Zoom in button | `aria-label="Zoom in"` |
| Zoom out button | `aria-label="Zoom out"` |
| Zoom level readout | `role="status" aria-live="polite" aria-label="Zoom level {N} percent"` — updates announced on change |
| Workspace selector | `aria-label="Filter by workspace"` |
| Detail panel | `role="region" aria-label="Agent details"` |

### Color-Blind Safe Status Indicators

Status is NEVER communicated by color alone. Each status has a distinct visual pattern in addition to color (per SIDE-02 precedent set in Phase 1):

| Status | Color | Shape / Pattern | Text Label |
|--------|-------|-----------------|------------|
| running | green | Solid border, filled circle, RUNNING chip | "RUNNING" |
| paused | yellow | Solid border, filled circle, PAUSED chip | "PAUSED" |
| stopped | gray | Dashed border (`4 3`), filled circle, DONE chip | "DONE" |
| error | red | Double ring (outer `<rect>` stroke), ERROR chip | "ERROR" |

The double-ring for error state: render a second `<rect>` at `x="-3" y="-3" width="146" height="50" rx="8"` with `stroke="var(--vscode-errorForeground)"` and `stroke-width="1"`, `fill="none"`. This gives a visible outer ring distinguishable in monochrome.

### Reduced Motion

Wrap `<animateMotion>` in a React conditional that checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. When reduced motion is preferred:
- Traveling dot animation is disabled entirely
- Active edges show a static filled circle at the midpoint of the path instead (indicates "active" without animation)

### Touch Targets

- All toolbar buttons: minimum 28×28px — exceeds the 24px minimum; falls below 44px recommendation but is consistent with VSCode's own toolbar conventions
- Node clickable area: 140×44px — exceeds 44px minimum in one axis, meets it in the other. Acceptable given graph density constraints.
- Workspace selector: native `<select>` — platform handles touch sizing

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| npm (d3-hierarchy) | `d3-hierarchy` ~15KB (D-21) | not required — MIT licensed, single-purpose math module, no DOM manipulation |
| npm (@types/d3-hierarchy) | dev dependency only | not required |

No shadcn, no third-party component registry. All visual components are hand-written React/SVG.

---

## Phase 2 Consistency Checklist

These patterns are carried forward unchanged from Phase 2 `dashboard.css` to maintain visual consistency:

| Pattern | Phase 2 Value | Phase 3 Usage |
|---------|---------------|---------------|
| Base font size | 13px | All body text, node names, toolbar labels |
| Secondary font size | 11px | Node session ID, status chips, detail panel keys |
| Heading weight | 600 | Node primary label, detail `h3`, toolbar section labels |
| Status dot size | 8px circle | Node status indicator (as `<circle r="4">` in SVG) |
| Status colors | terminal ansi variables | Node borders, edge strokes, status dots |
| Focus indicator | `1px solid var(--vscode-focusBorder)` | All interactive elements |
| Empty state pattern | h2 (600) + p (400, muted) | Graph empty state + detail panel empty state |
| Error foreground | `var(--vscode-errorForeground)` | Error status node, error edge |
| Border variable | `var(--vscode-widget-border)` | All panel dividers, node borders (default) |
| Background hierarchy | editor-background > sideBar-background | Graph area > toolbar and detail panel |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
