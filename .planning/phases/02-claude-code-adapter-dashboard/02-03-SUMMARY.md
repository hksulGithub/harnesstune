---
phase: 02-claude-code-adapter-dashboard
plan: "03"
subsystem: dashboard-ui
tags: [react, webview, vscode-panel, esbuild, css-variables, postMessage, master-detail]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [DashboardPanel, WorkspaceTabs, SummaryBar, AgentCard, AgentDetailPanel, ControlButtons]
  affects: [02-04]
tech_stack:
  added: []
  patterns: [WebviewPanel, nonce-CSP, getState/setState, postMessage-typed, ESM-webview-bundle, VSCode-CSS-variables]
key_files:
  created:
    - src/panels/DashboardPanel.ts
    - src/webview/dashboard/vscodeApi.ts
    - src/webview/dashboard/index.tsx
    - src/webview/dashboard/App.tsx
    - src/webview/dashboard/components/WorkspaceTabs.tsx
    - src/webview/dashboard/components/SummaryBar.tsx
    - src/webview/dashboard/components/AgentCard.tsx
    - src/webview/dashboard/components/AgentDetailPanel.tsx
    - src/webview/dashboard/components/ControlButtons.tsx
    - src/webview/dashboard/styles/dashboard.css
  modified:
    - src/panels/index.ts
    - esbuild.mjs
key_decisions:
  - "DashboardPanel.currentPanel is public static (not private) so extension.ts wiring in Plan 04 can check panel availability and push events without importing internals"
  - "retainContextWhenHidden: false — dashboard uses getState/setState for persistence instead of keeping DOM alive, matching D-13"
  - "acquireVsCodeApi() called once in vscodeApi.ts module scope, exported as default — all dashboard components import from this single module"
  - "App.tsx computes aggregate summary from sessions directly when no per-workspace summary exists in the summaries Map, avoiding stale data from race conditions on initial load"
requirements:
  - DASH-01
  - DASH-02
  - DASH-03
metrics:
  duration: "~4 min"
  completed: "2026-04-16T10:14:36Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 10
  files_modified: 2
---

# Phase 02 Plan 03: Dashboard WebviewPanel React UI Summary

**One-liner:** VSCode WebviewPanel host class with nonce-CSP and typed postMessage, plus full React dashboard UI — workspace tabs, summary bar, master-detail agent list, and agent detail panel — all styled with VSCode CSS variables and built via esbuild ESM.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | DashboardPanel host class and esbuild config | c6cc667 | src/panels/DashboardPanel.ts, src/webview/dashboard/vscodeApi.ts, src/webview/dashboard/index.tsx, esbuild.mjs |
| 2 | React components and CSS | 90e748d | src/webview/dashboard/App.tsx, components/WorkspaceTabs.tsx, SummaryBar.tsx, AgentCard.tsx, AgentDetailPanel.tsx, ControlButtons.tsx, styles/dashboard.css |

## What Was Built

### Task 1: DashboardPanel Extension Host Class

`src/panels/DashboardPanel.ts` — WebviewPanel lifecycle manager.

- `public static currentPanel` — deliberately public for Plan 04 extension.ts wiring to push events when panel is open
- `createOrShow(extensionUri)` — reveals existing panel or creates new `ViewColumn.One` panel with `retainContextWhenHidden: false`
- `revive(panel, extensionUri)` — called by `WebviewPanelSerializer` on VSCode restart
- `getHtmlForWebview()` — nonce-based CSP (`default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'`), loads `dist/webview/dashboard.js`
- `postMessage(HostToWebviewMessage)` — typed push to webview
- `onDidReceiveMessage` — EventEmitter event for typed messages from webview

`esbuild.mjs` — `dashboardConfig` added in parallel to `sidebarConfig`. Both watch and build `Promise.all` arrays updated. sql-wasm.wasm copy step preserved.

`src/webview/dashboard/vscodeApi.ts` — `acquireVsCodeApi()` called once in module scope, typed `VsCodeApi` interface with `postMessage(WebviewToHostMessage)`, `getState()`, `setState()`.

`src/webview/dashboard/index.tsx` — React 18 `createRoot` entry point, imports `App` and `dashboard.css`.

### Task 2: React Dashboard Components

`src/webview/dashboard/App.tsx` — Root component with full state management:
- `useEffect` message listener for `dashboard:agentEvents`, `dashboard:agentUpdate`, `dashboard:summary`
- On mount: `vscode.postMessage({ type: 'dashboard:requestState' })`
- State persistence: `vscode.setState/getState` on `activeWorkspaceId` and `selectedSessionId`
- Workspace list derived from sessions (unique workspaceIds + agent counts)
- Filtering: sessions filtered by `activeWorkspaceId` when non-null
- Aggregate summary computed from filtered sessions when per-workspace summary unavailable

`src/webview/dashboard/components/WorkspaceTabs.tsx` — "All Workspaces" tab always first, per-workspace tabs with agent count badges, `role="tablist"` accessibility.

`src/webview/dashboard/components/SummaryBar.tsx` — 4 metrics: Total (codicon-organization), Running (codicon-pulse), Paused (codicon-debug-pause), Errors (codicon-error). 18px semibold values, 11px labels.

`src/webview/dashboard/components/AgentCard.tsx` — `<button role="option">` per UI-SPEC, 8px status dot with semantic class, name/role info block, inline `ControlButtons`. `aria-label` on both card and status dot.

`src/webview/dashboard/components/AgentDetailPanel.tsx` — Empty state when no session selected. Header with status dot + ControlButtons (size="large"). Info grid (Role, Model, Session ID, PID, Workspace, Started). Token usage bar from event aggregation. Recent actions list (last 10 tool events, reversed). Config excerpt in `<details>` with JSON.

`src/webview/dashboard/components/ControlButtons.tsx` — Running state: Pause + Stop buttons. Paused state: Resume + Stop. Stopping: disabled loading indicator. Stopped: null (no buttons). All buttons have `aria-label`. Stop button has `.destructive` class. `e.stopPropagation()` prevents card selection on button click.

`src/webview/dashboard/styles/dashboard.css` — Full CSS with VSCode CSS variables. All colors from `--vscode-*` properties. Covers: base, tab bar, summary bar, master-detail, agent card, control buttons, detail panel sections, empty states, accessibility focus outlines.

## Decisions Made

1. **`currentPanel` is `public static`** — Plan 04 will wire `DashboardPanel.currentPanel?.postMessage(...)` from `extension.ts` to push live agent events. Private would force awkward getter or event bus pattern.

2. **`retainContextWhenHidden: false`** — Matches D-13. Dashboard uses `vscode.getState()/setState()` for restoring `activeWorkspaceId` and `selectedSessionId` across panel hide/show cycles. Retaining DOM would waste memory for a data-driven panel.

3. **Single vscodeApi.ts module for all components** — All dashboard components import `vscode` from `../vscodeApi` (or `../../vscodeApi` for nested). This guarantees the single-call constraint is enforced structurally rather than by convention.

4. **App.tsx aggregate summary fallback** — When `activeWorkspaceId === null` or no summary exists in the `summaries` Map, the app computes counts directly from the `sessions` array. This provides correct data on initial load before any `dashboard:summary` messages arrive.

## Deviations from Plan

None — plan executed exactly as written. The CSS in `dashboard.css` was also created in Task 1 (before the React components) so the esbuild build for Task 1 verification would succeed without import errors from `index.tsx`.

## Verification Results

```
node esbuild.mjs
[esbuild] Build complete.
[esbuild] sql-wasm.wasm copied to dist/
```

```
npx tsc --noEmit -p tsconfig.webview.json
(no output — clean)
```

```
npx tsc --noEmit -p tsconfig.extension.json
(no output — clean)
```

```
grep -r "acquireVsCodeApi" src/webview/dashboard/
src/webview/dashboard/vscodeApi.ts (only here — called once)
```

```
grep "retainContextWhenHidden" src/panels/DashboardPanel.ts
retainContextWhenHidden: false
```

All 14 Task 1 acceptance criteria: PASS
All 25 Task 2 acceptance criteria: PASS

## Self-Check: PASSED

Files verified present:
- src/panels/DashboardPanel.ts — FOUND
- src/panels/index.ts (contains DashboardPanel export) — FOUND
- src/webview/dashboard/vscodeApi.ts — FOUND
- src/webview/dashboard/index.tsx — FOUND
- src/webview/dashboard/App.tsx — FOUND
- src/webview/dashboard/components/WorkspaceTabs.tsx — FOUND
- src/webview/dashboard/components/SummaryBar.tsx — FOUND
- src/webview/dashboard/components/AgentCard.tsx — FOUND
- src/webview/dashboard/components/AgentDetailPanel.tsx — FOUND
- src/webview/dashboard/components/ControlButtons.tsx — FOUND
- src/webview/dashboard/styles/dashboard.css — FOUND
- dist/webview/dashboard.js — FOUND

Commits verified:
- c6cc667 — feat(02-03): DashboardPanel host class and esbuild dashboard config
- 90e748d — feat(02-03): Dashboard React components and CSS

Next: Ready for 02-04 (extension.ts wiring — connects DashboardPanel to HookServer, AgentControlManager, and command palette)
