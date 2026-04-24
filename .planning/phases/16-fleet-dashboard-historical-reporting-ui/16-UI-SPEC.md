---
phase: 16
slug: fleet-dashboard-historical-reporting-ui
status: approved
reviewed_at: 2026-04-24T04:00:00.000Z
shadcn_initialized: false
preset: none
created: 2026-04-24
---

# Phase 16 — UI Design Contract
## Fleet Dashboard + Historical Reporting UI

---

## 1. Design System

| Property | Value |
|---|---|
| Tool | none (plain CSS with VSCode CSS custom properties) |
| Preset | not applicable |
| Component library | none (custom React components) |
| Icon library | unicode characters (established project pattern — codicons unavailable in webviews) |
| Font | var(--vscode-font-family) |
| shadcn | false |
| Tailwind | false |
| Registry safety | not applicable — no shadcn or third-party registries |

---

## 2. Typography

All type is set in `var(--vscode-font-family)`. No new font sizes are introduced; all values match existing dashboard.css conventions.

| Role | Size | Weight | Line-height | Usage |
|---|---|---|---|---|
| Body | 13px | 400 | 1.4 | Default text, agent names, workspace names, table rows |
| Label | 11px | 400 | 1.2 | Timestamps, badges, descriptions, column headers, health labels |
| Heading | 13px | 600 | 1.4 | Section titles, card titles, panel headers |
| Display (metric) | 18px | 600 | 1.2 | Summary metric values: agent count, error rate, total cost |

---

## 3. Spacing Scale

Inherited from existing dashboard.css and reports.css. No new values introduced.

| Token | Value | Usage |
|---|---|---|
| xs | 4px | Icon-to-text gaps, status dot margin, inline gaps |
| sm | 8px | Compact internal padding, gap between badge and label |
| md | 12px | Card internal padding, cell padding in tables |
| lg | 16px | Section vertical gap, between-card gap |
| xl | 24px | Panel section separation |
| 2xl | 32px | Empty state top/bottom padding |
| 3xl | 48px | Fleet Overview empty state top padding when panel height > 400px |

---

## 4. Color

All colors are VSCode CSS custom properties. No hex values are specified. Theme adaptation (light/dark/high-contrast) is automatic.

### 4.1 60-30-10 Role Allocation

| Role | Variable | Coverage | Usage |
|---|---|---|---|
| Dominant | `var(--vscode-editor-background)` | ~60% | Page background, table body, drill-down view background |
| Secondary | `var(--vscode-sideBar-background)` | ~30% | Workspace cards, breadcrumb bar, date range selector bar, column header row |
| Accent | `var(--vscode-focusBorder)` | ~10% | Active breadcrumb segment underline, selected date range tab indicator, keyboard-focused element outline |

### 4.2 Semantic Colors

| Role | Variable | Usage |
|---|---|---|
| Body text | `var(--vscode-foreground)` | Primary readable text |
| Secondary text | `var(--vscode-descriptionForeground)` | Timestamps, labels, secondary metadata |
| Destructive / error | `var(--vscode-errorForeground)` | Error state text, red health indicator, cost trend down |
| Border / separator | `var(--vscode-panel-border)` | Row separators, card borders, table dividers |
| Hover background | `var(--vscode-list-hoverBackground)` | Card hover, table row hover |
| Focus outline | `var(--vscode-focusBorder)` | 1px solid outline on focused interactive elements |
| Input background | `var(--vscode-input-background)` | Not used in this phase (no free-text inputs) |

### 4.3 Health Indicator Colors

Health indicators are 8px filled circles (matching existing status dot convention).

| State | Variable | Label |
|---|---|---|
| Healthy (green) | `var(--vscode-terminal-ansiGreen)` | "Healthy" |
| Degraded (yellow) | `var(--vscode-terminal-ansiYellow)` | "Degraded" |
| Failing (red) | `var(--vscode-errorForeground)` | "Failing" |
| No Data / Disabled (gray) | `var(--vscode-descriptionForeground)` | "No Data" |

### 4.4 Trend Indicator Colors

Trend arrows appear inline next to cost values.

| Direction | Unicode | Variable |
|---|---|---|
| Up (cost increasing) | ↑ | `var(--vscode-errorForeground)` |
| Down (cost decreasing) | ↓ | `var(--vscode-terminal-ansiGreen)` |
| Flat (no change) | → | `var(--vscode-descriptionForeground)` |

---

## 5. Navigation Architecture

### 5.1 View Hierarchy

The Dashboard panel implements three view levels via view-replacement (not accordion, not sidebar navigation). Only one level is rendered at a time. React state at the root component controls the active view.

```
Fleet Overview  (level 0 — default)
  └── Workspace Drill-Down  (level 1 — triggered by workspace card click)
        └── Agent Detail  (level 2 — triggered by agent row click)
```

### 5.2 Breadcrumb Bar

- Rendered at the top of the panel, below the date range selector bar, when depth >= 1.
- At depth 0 (Fleet Overview): breadcrumb bar is hidden.
- At depth 1: "Fleet > {Workspace Name}"
- At depth 2: "Fleet > {Workspace Name} > {Agent Name}"
- Separator: ` > ` (space-chevron-space, plain text, not an icon)
- "Fleet" is always a clickable link (returns to level 0).
- Workspace name is a clickable link at depth 2 (returns to level 1).
- Current segment (rightmost) is non-interactive, rendered at weight 600, color `var(--vscode-foreground)`.
- Ancestor segments are interactive: color `var(--vscode-descriptionForeground)`, hover color `var(--vscode-foreground)`, underline on hover.
- Active segment underline indicator: 2px solid `var(--vscode-focusBorder)` below the current breadcrumb segment.
- Bar background: `var(--vscode-sideBar-background)`.
- Bar padding: 8px (sm) 12px (md).
- Font: 11px, weight 400, line-height 1.2 (Label scale).

### 5.3 Date Range Selector

- Rendered as a horizontal tab strip at the top of the panel, above the breadcrumb bar.
- Tabs: "24h" | "3d" | "7d" | "30d"
- Default selected: "7d"
- State is held in root React component and passed down to all three view levels via props.
- Changing date range while in drill-down re-fetches data for the current view at the new range; does not reset navigation depth.
- Active tab indicator: 2px solid `var(--vscode-focusBorder)` bottom border on the active tab.
- Active tab text: `var(--vscode-foreground)`, weight 600.
- Inactive tab text: `var(--vscode-descriptionForeground)`, weight 400.
- Strip background: `var(--vscode-sideBar-background)`.
- Strip padding: 8px (sm) 12px (md).
- Tab font: 13px, weight 400/600, line-height 1.4 (Body scale).
- Tab internal padding: 4px (xs) 8px (sm).
- No border-radius on tabs (flat, matches VSCode panel tab aesthetic).

---

## 6. Component Specifications

### 6.1 Fleet Overview (Level 0) — FDSH-01

**Layout:** Vertical list of workspace platform cards. No grid — single column, full panel width.

**Panel Header:**
- Text: "Agent Fleet" — 13px, weight 600, `var(--vscode-foreground)`.
- Sub-label: "{N} workspaces" — 11px, weight 400, `var(--vscode-descriptionForeground)`.
- Padding: 12px (md) 12px (md) 8px (sm) 12px (md).

**Workspace Card:**
- Background: `var(--vscode-sideBar-background)`.
- Border-bottom: 1px solid `var(--vscode-panel-border)`.
- Hover background: `var(--vscode-list-hoverBackground)`.
- Padding: 12px (md).
- Cursor: pointer (entire card is clickable).
- Focus: 1px solid `var(--vscode-focusBorder)` inset outline.
- No border-radius.

**Card Layout (top row):**
- Container: `display: flex; align-items: center; justify-content: space-between;`
- Left cluster: `display: flex; align-items: center; gap: 4px (xs); min-width: 0; flex: 1 1 auto;` — Health dot (8px circle) + Workspace name (13px, weight 600, `var(--vscode-foreground)`, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`).
- Right cluster: `flex: 0 0 auto; margin-left: 8px (sm);` — Platform badge (11px label, `var(--vscode-descriptionForeground)`) — e.g., "GitHub Actions", "Local".

**Card Layout (metric row):**
- Container: `display: flex; align-items: baseline; gap: 16px (lg); flex-wrap: wrap;`
- Three inline metrics, separated by 16px (lg) gap:
  1. Agents: "{N} agents" — value 18px weight 600, label 11px.
  2. Error Rate: "{N}%" — value 18px weight 600, label 11px. Color: `var(--vscode-errorForeground)` if > 0%, else `var(--vscode-foreground)`.
  3. Last Activity: "{relative time}" — value 13px weight 400, label 11px, `var(--vscode-descriptionForeground)`.
- Metric value color: `var(--vscode-foreground)` unless overridden by semantic rule above.
- Metric label color: `var(--vscode-descriptionForeground)`.
- Metric row top margin: 8px (sm).

**Card CTA:**
- Text: "View agents →"
- Position: right-aligned on a third row below metrics.
- Font: 11px, `var(--vscode-descriptionForeground)`.
- On hover: `var(--vscode-foreground)` with underline.
- This is a secondary affordance; the full card is also clickable.

**Fleet Empty State:**
- Heading: "No workspaces connected" — 13px, weight 600, `var(--vscode-foreground)`.
- Body: "Add a workspace to start monitoring your agent fleet." — 13px, weight 400, `var(--vscode-descriptionForeground)`.
- Layout: centered, padding 32px (2xl) top/bottom, 8px (sm) gap between heading and body. When panel height > 400px, use 48px (3xl) top padding.

**Fleet Error State:**
- Text: "Failed to load fleet data. Check your workspace connections and try again."
- Color: `var(--vscode-errorForeground)`.
- Font: 13px, weight 400.
- Layout: centered, padding 32px top/bottom.

### 6.2 Workspace Drill-Down (Level 1) — FDSH-02

**Panel Header:**
- Workspace name — 13px, weight 600, `var(--vscode-foreground)`.
- Sub-label: "{N} agents" — 11px, weight 400, `var(--vscode-descriptionForeground)`.
- Padding: 12px (md) 12px (md) 8px (sm) 12px (md).

**Cost Summary Bar (Workspace Level) — FDSH-06:**
- Background: `var(--vscode-sideBar-background)`.
- Border-bottom: 1px solid `var(--vscode-panel-border)`.
- Padding: 8px (sm) 12px (md).
- Content (inline, left-to-right):
  - Label: "Workspace Total:" — 11px, `var(--vscode-descriptionForeground)`.
  - Value: "$0.00" — 13px, weight 600, `var(--vscode-foreground)`.
  - Trend arrow: unicode character (↑ / ↓ / →) — 11px, colored per Section 4.4.
  - Token count: "({N} tokens)" — 11px, `var(--vscode-descriptionForeground)`.
- Gap between elements: 4px (xs).

**Agent List:**
- Each agent is a row with border-bottom: 1px solid `var(--vscode-panel-border)`.
- Row hover: `var(--vscode-list-hoverBackground)`.
- Row padding: 8px (sm) 12px (md).
- Cursor: pointer (entire row clickable).
- Focus: 1px solid `var(--vscode-focusBorder)`.

**Agent Row Layout:**
- Container: `display: flex; align-items: center; justify-content: space-between;`

Left cluster (`display: flex; align-items: center; gap: 4px (xs); min-width: 0; flex: 1 1 auto;`):
- Health dot (8px circle) + Agent name (13px, weight 600, `var(--vscode-foreground)`, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`).

Right cluster (`display: flex; align-items: center; gap: 16px (lg); flex: 0 0 auto; margin-left: 8px (sm);`):
- Success Rate: "{N}%" — 13px, weight 400. Color `var(--vscode-terminal-ansiGreen)` if >= 90%, `var(--vscode-terminal-ansiYellow)` if 50–89%, `var(--vscode-errorForeground)` if < 50%.
- Last Run: "{relative time}" — 11px, `var(--vscode-descriptionForeground)`.
- Cost: "$0.00 {trend arrow}" — 11px, `var(--vscode-descriptionForeground)`.

**Workspace Empty State:**
- Heading: "No agents discovered" — 13px, weight 600, `var(--vscode-foreground)`.
- Body: "This workspace has no agents yet. Run a collector to discover agents." — 13px, weight 400, `var(--vscode-descriptionForeground)`.
- Layout: centered, padding 32px top/bottom, 8px gap.

**Workspace Error State:**
- Text: "Failed to load agents for this workspace. Check the collector status and try refreshing." — 13px, weight 400, `var(--vscode-errorForeground)`.
- Layout: centered, padding 32px (2xl) top/bottom.

### 6.3 Agent Detail (Level 2) — FDSH-03

**Panel Header:**
- Agent name — 13px, weight 600, `var(--vscode-foreground)`.
- Sub-label: "in {Workspace Name}" — 11px, weight 400, `var(--vscode-descriptionForeground)`.
- Padding: 12px (md) 12px (md) 8px (sm) 12px (md).

**Cost Summary Bar (Agent Level) — FDSH-06:**
- Same structure as workspace cost summary bar (Section 6.2).
- Label: "Agent Total:"
- Includes: total cost value, trend arrow, token count.

**Run History Table — FDSH-03:**

Column headers row:
- Background: `var(--vscode-sideBar-background)`.
- Font: 11px, weight 400, `var(--vscode-descriptionForeground)`.
- Padding: 8px (sm) 12px (md).
- Border-bottom: 1px solid `var(--vscode-panel-border)`.
- Columns (left to right): Timestamp | Duration | Status | Cost | (expand toggle — no header text).

Data rows:
- Font: 13px, weight 400, `var(--vscode-foreground)`.
- Padding: 8px (sm) 12px (md).
- Border-bottom: 1px solid `var(--vscode-panel-border)`.
- Hover background: `var(--vscode-list-hoverBackground)`.
- Alternating row background: none (flat, matching existing table pattern).

Table layout: `display: table; width: 100%; table-layout: fixed;`

Column specs:

| Column | Width | Font | Color | Notes |
|---|---|---|---|---|
| Timestamp | 35% | 11px | `var(--vscode-descriptionForeground)` | ISO-8601 date-time, formatted as "MMM D, HH:mm" |
| Duration | 20% | 13px | `var(--vscode-foreground)` | "{N}s" or "{N}m {N}s" |
| Status | 25% | 11px + dot | per health color | 8px dot + label text ("Healthy" / "Degraded" / "Failing" / "No Data") |
| Cost | 15% | 13px | `var(--vscode-foreground)` | "$0.00" |
| Expand | 5% (min 24px) | unicode "+" / "−" | `var(--vscode-descriptionForeground)` | Toggles log section; 13px |

**Expandable Log Section:**
- Triggered by clicking the expand toggle cell in a run row.
- Rendered as a full-width sub-row immediately below the parent row.
- Background: `var(--vscode-editor-background)` (dominant — visually recessed).
- Border-bottom: 1px solid `var(--vscode-panel-border)`.
- Padding: 8px (sm) 12px (md) 8px (sm) 24px (xl) (extra left indent to visually nest under row).
- Font: 11px, weight 400, line-height 1.4, `var(--vscode-descriptionForeground)`.
- Content: raw log text, pre-wrapped (`white-space: pre-wrap`).
- Max-height: 200px with `overflow-y: auto`.

**Agent Detail Empty State:**
- Heading: "No runs recorded" — 13px, weight 600, `var(--vscode-foreground)`.
- Body: "Agent runs will appear here once the collector reports data." — 13px, weight 400, `var(--vscode-descriptionForeground)`.
- Layout: centered, padding 32px top/bottom, 8px gap.

**Agent Detail Error State:**
- Text: "Failed to load run history for this agent. Check the collector status and try refreshing." — 13px, weight 400, `var(--vscode-errorForeground)`.
- Layout: centered, padding 32px (2xl) top/bottom.

---

## 7. Health Indicator Specification — FDSH-05

Health state is computed from run data within the selected date range. The following rules govern assignment:

| State | Label | Dot Color | Condition |
|---|---|---|---|
| Healthy | "Healthy" | `var(--vscode-terminal-ansiGreen)` | All runs passed within the date range |
| Degraded | "Degraded" | `var(--vscode-terminal-ansiYellow)` | Some failures present but not consecutive |
| Failing | "Failing" | `var(--vscode-errorForeground)` | 3+ consecutive failures OR last run failed AND stale (no run in 24h) |
| No Data | "No Data" | `var(--vscode-descriptionForeground)` | No runs in the date range, or agent is disabled |

Health state is displayed:
- As an 8px filled circle on workspace cards (fleet overview).
- As an 8px filled circle on agent rows (workspace drill-down).
- As an 8px filled circle + label text in the Status column (agent detail table).

Dot sizing: `width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;`

---

## 8. Cost Summary Specification — FDSH-06

Cost data is derived from `~/.harnesstune/cron-runs/*.json` via the FleetDataProvider abstraction (D-05, D-06).

**Per-Agent cost fields:**
- `totalCost`: sum of cost across all runs in the date range, displayed as "$0.00".
- `totalTokens`: sum of tokens across all runs, displayed as "({N} tokens)".
- `trend`: computed by comparing current period cost to previous equal-length period. Result: "up" | "down" | "flat".

**Per-Workspace cost fields:**
- Same fields, aggregated across all agents in the workspace.

**Trend arrow rendering:**
- Placed immediately after the cost value, separated by 4px gap.
- Character and color per Section 4.4.
- Font size: 11px.

**Cost format:**
- Always two decimal places: "$0.00".
- Zero cost displayed as "$0.00" (not hidden).
- No thousands separator for values < $1,000. Use "$1,234.56" format for values >= $1,000.

---

## 9. Interaction States

| Element | Default | Hover | Focus | Active |
|---|---|---|---|---|
| Workspace card | sideBar-background bg | list-hoverBackground bg | 1px focusBorder inset outline | no change |
| Agent row | transparent bg | list-hoverBackground bg | 1px focusBorder inset outline | no change |
| Run history row | transparent bg | list-hoverBackground bg | 1px focusBorder inset outline | no change |
| Date range tab | descriptionForeground text | foreground text | 1px focusBorder outline | — |
| Date range tab (active) | foreground text, weight 600, 2px focusBorder bottom | — | — | — |
| Breadcrumb ancestor | descriptionForeground, no underline | foreground, underline | 1px focusBorder outline | — |
| Breadcrumb current | foreground, weight 600, 2px focusBorder underline | no change | — | — |
| Expand toggle | descriptionForeground "+" | foreground | 1px focusBorder outline | "−" when open |

All interactive elements must be keyboard-accessible (tab order, Enter/Space activation).

---

## 10. Responsive Behavior

The webview panel has a fixed minimum width of 280px (VSCode sidebar constraint). Layout adjusts as follows:

- At < 360px: right clusters on agent rows and workspace cards stack below the left cluster (flex-direction: column).
- At >= 360px: left and right clusters are on the same row (flex-direction: row, justify-content: space-between).
- Date range tabs: if panel width < 320px, tab labels remain as-is (no truncation — labels are already short: "24h", "3d", "7d", "30d").
- Run history table: at < 360px, "Cost" column is hidden; shown at >= 360px.
- No horizontal scroll is introduced. All content remains within the panel width.

---

## 11. Copywriting Contract

All copy strings are final and must be used verbatim in implementation.

### Labels and Headings

| Location | String |
|---|---|
| Fleet overview panel header | "Agent Fleet" |
| Workspace drill-down sub-label | "{N} agents" |
| Agent detail sub-label | "in {Workspace Name}" |
| Cost summary (workspace) label | "Workspace Total:" |
| Cost summary (agent) label | "Agent Total:" |
| Date range tabs | "24h" / "3d" / "7d" / "30d" |
| Breadcrumb separator | " > " |
| Breadcrumb root | "Fleet" |
| Expand toggle (collapsed) | "+" |
| Expand toggle (expanded) | "−" |
| Health label: green | "Healthy" |
| Health label: yellow | "Degraded" |
| Health label: red | "Failing" |
| Health label: gray | "No Data" |
| Workspace card CTA | "View agents →" |

### Table Column Headers

| Column | Header string |
|---|---|
| Timestamp | "Timestamp" |
| Duration | "Duration" |
| Status | "Status" |
| Cost | "Cost" |
| Expand | (empty) |

### Empty States

| View | Heading | Body |
|---|---|---|
| Fleet Overview | "No workspaces connected" | "Add a workspace to start monitoring your agent fleet." |
| Workspace Drill-Down | "No agents discovered" | "This workspace has no agents yet. Run a collector to discover agents." |
| Agent Detail | "No runs recorded" | "Agent runs will appear here once the collector reports data." |

### Error States

| Scope | String |
|---|---|
| Fleet data load failure | "Failed to load fleet data. Check your workspace connections and try again." |
| Workspace agent load failure | "Failed to load agents for this workspace. Check the collector status and try refreshing." |
| Agent detail load failure | "Failed to load run history for this agent. Check the collector status and try refreshing." |

---

## 12. Data Requirements per View

This section defines the minimum data shape each view needs from FleetDataProvider (D-05). Implementation of the provider is out of scope for this UI spec; this table serves as a contract for the data layer.

### Fleet Overview

```
WorkspaceSummary {
  id: string
  name: string
  platform: string          // e.g. "Local", "GitHub Actions"
  health: "healthy" | "degraded" | "failing" | "no-data"
  agentCount: number
  errorRatePct: number      // 0-100
  lastActivityTs: number    // unix ms
}[]
```

### Workspace Drill-Down

```
AgentSummary {
  id: string
  name: string
  health: "healthy" | "degraded" | "failing" | "no-data"
  successRatePct: number    // 0-100
  lastRunTs: number         // unix ms
  costUsd: number
  costTrend: "up" | "down" | "flat"
}[]

WorkspaceCost {
  totalCostUsd: number
  totalTokens: number
  trend: "up" | "down" | "flat"
}
```

### Agent Detail

```
RunRecord {
  runId: string
  timestampTs: number       // unix ms
  durationMs: number
  status: "healthy" | "degraded" | "failing" | "no-data"
  costUsd: number
  logText: string           // raw log, may be empty string
}[]

AgentCost {
  totalCostUsd: number
  totalTokens: number
  trend: "up" | "down" | "flat"
}
```

---

## 13. File and Component Map

New files to be created in Phase 16. Existing files must not be restructured unless listed here.

| File path (relative to src/) | Purpose |
|---|---|
| `webviews/dashboard/FleetOverview.tsx` | Level 0 view component |
| `webviews/dashboard/WorkspaceDrillDown.tsx` | Level 1 view component |
| `webviews/dashboard/AgentDetail.tsx` | Level 2 view component |
| `webviews/dashboard/BreadcrumbBar.tsx` | Breadcrumb navigation bar |
| `webviews/dashboard/DateRangeSelector.tsx` | Date range tab strip |
| `webviews/dashboard/HealthDot.tsx` | 8px status dot, reusable |
| `webviews/dashboard/CostSummaryBar.tsx` | Cost summary bar, reusable (workspace + agent levels) |
| `webviews/dashboard/RunLogExpander.tsx` | Expandable log sub-row |
| `webviews/dashboard/fleet.css` | New CSS file for fleet dashboard styles |
| `providers/FleetDataProvider.ts` | Abstract provider interface (D-05) |
| `providers/LocalFleetProvider.ts` | Local file reader implementation (D-06) |
| `providers/RemoteFleetProvider.ts` | Remote implementation (stub for Phase 16) |

The root dashboard entry point (existing) is updated to mount the new fleet view hierarchy and pass date range state down. The existing dashboard.css remains unchanged; fleet.css adds only fleet-specific rules.

---

## 14. Registry Safety

Not applicable. This project uses no shadcn, no third-party component registries, no Tailwind, and no external CSS frameworks. All styles are plain CSS using VSCode CSS custom properties. There is no registry initialization, no component installation step, and no lock file dependency on UI libraries.

---

## 15. Checker Sign-Off

| Check | Status |
|---|---|
| Typography matches existing dashboard.css conventions | [ ] |
| All colors are VSCode CSS variables (no hex values) | [ ] |
| No new spacing values outside established scale | [ ] |
| No shadcn or Tailwind references | [ ] |
| All empty states have heading + body copy defined | [ ] |
| All error states have copy defined | [ ] |
| Health indicator colors match FDSH-05 | [ ] |
| Cost trend arrows use unicode (not icon library) | [ ] |
| Breadcrumb separator is " > " (text, not icon) | [ ] |
| Date range selector state is at root level (D-04) | [ ] |
| Navigation is view-replacement not accordion (D-03) | [ ] |
| Agent detail is in-Dashboard not cross-panel (D-02) | [ ] |
| Dashboard panel is redesigned; Reports panel untouched (D-01) | [ ] |
| Data shapes defined for all three view levels | [ ] |
| File/component map provided | [ ] |
