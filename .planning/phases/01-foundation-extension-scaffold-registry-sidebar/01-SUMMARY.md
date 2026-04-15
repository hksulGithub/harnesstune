---
phase: 01-foundation-extension-scaffold-registry-sidebar
plan: 01
subsystem: extension-scaffold
tags: [extension, esbuild, typescript, types, scaffold]
dependency_graph:
  requires: []
  provides: [package.json, src/extension.ts, src/types/workspace.ts, src/types/messages.ts, src/types/status.ts, esbuild.mjs]
  affects: [02-PLAN.md, 03-PLAN.md]
tech_stack:
  added: [esbuild@0.24, typescript@5.6, react@18.3, @types/vscode@1.96]
  patterns: [dual-target esbuild build, tsconfig per runtime, discriminated union message contracts, color+shape status indicators]
key_files:
  created:
    - package.json
    - tsconfig.json
    - tsconfig.extension.json
    - tsconfig.webview.json
    - esbuild.mjs
    - src/extension.ts
    - src/webview/sidebar/index.tsx
    - src/types/workspace.ts
    - src/types/messages.ts
    - src/types/status.ts
    - src/types/index.ts
    - resources/icon.svg
    - .vscodeignore
    - .gitignore
  modified: []
decisions:
  - "esbuild dual-target: CJS for extension host (Node.js), ESM for webview bundles (browser) — prevents Node/DOM API confusion at bundle boundary"
  - "Two separate tsconfigs: tsconfig.extension.json has no DOM lib, tsconfig.webview.json has DOM + JSX — enforces correct runtime types at development time"
  - "Status indicators always pair color + shape (never color alone) — per SIDE-02 accessibility requirement"
  - "IWorkspaceRegistry interface defined here so Plan 02 implementation and Plan 03 sidebar both import from the same contract"
  - "Sidebar index.tsx placeholder created to allow esbuild dual-target build to succeed before Plan 03 implements it"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_created: 14
  files_modified: 0
---

# Phase 1 Plan 01: Extension Scaffold Summary

Extension scaffold and shared type contracts — TypeScript extension with dual-target esbuild (CJS host + ESM webview) and all shared interfaces that Plans 02 and 03 depend on.

## What Was Built

### Task 1: Extension scaffold with dual-target esbuild build (commit: dbfb5e7)

Created the complete VSCode extension scaffold:

- **package.json**: HarnessTune manifest with 5 commands (`connectWorkspace`, `removeWorkspace`, `openWorkspace`, `refreshSidebar`, `showDashboard`) all under `HarnessTune:` category, `viewsContainers.activitybar` with `harnesstune-sidebar`, and `views` with a `webview` type entry for `harnesstune.sidebarView`
- **tsconfig.json** (base), **tsconfig.extension.json** (extends base, `lib: ["ES2022"]` only — no DOM), **tsconfig.webview.json** (extends base, adds `DOM`, `DOM.Iterable`, `jsx: "react-jsx"`)
- **esbuild.mjs**: Dual-entry build — extension host as CJS targeting Node.js 20 with `vscode` external; sidebar webview as ESM targeting browser es2022
- **src/extension.ts**: `activate` registers 5 stub commands and pushes all to `context.subscriptions`; `deactivate` is a clean no-op log
- **src/webview/sidebar/index.tsx**: Placeholder allowing the ESM bundle to compile (implementation in Plan 03)
- **resources/icon.svg**: Gear icon for the activity bar

Build verified: `node esbuild.mjs` exits 0, producing `dist/extension.js` (CJS) and `dist/webview/sidebar.js` (ESM).

### Task 2: Shared type contracts (commit: 01d7f4a)

- **src/types/workspace.ts**: `WorkspaceStatus` union, `WorkspaceRecord` interface (8 fields), `WorkspaceRegistryData` (version literal + array), `IWorkspaceRegistry` with `getAll/getById/add/remove/update/onDidChange`
- **src/types/status.ts**: `StatusShape` union, `StatusIndicator` interface (status + color + shape + label + svgPath), `STATUS_INDICATORS` constant with all 5 status mappings using VSCode CSS variables, `AgentStatus` type alias
- **src/types/messages.ts**: `HostToWebviewMessage` (4 variants: `workspaces:update`, `workspace:statusChanged`, `workspace:removed`, `workspace:added`) and `WebviewToHostMessage` (5 variants including `ready`) as discriminated unions
- **src/types/index.ts**: Barrel re-export of all three modules

TypeScript verified: `npx tsc --project tsconfig.extension.json --noEmit` exits 0 with no errors.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Placeholder sidebar index.tsx | esbuild.mjs defines both entry points; without the file the build fails; Plan 03 replaces it with full React implementation |
| `IWorkspaceRegistry` in workspace.ts | Single source of truth for the registry contract — Plan 02 implements it, Plan 03 imports it for type safety in message handlers |
| VSCode CSS variables in STATUS_INDICATORS | Never hardcode colors; CSS variables adapt to VSCode theme automatically |
| Color + shape in every StatusIndicator | SIDE-02 accessibility requirement: status must never be communicated by color alone |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| `npm install` | Pass (15 packages, 1 moderate advisory — not blocking) |
| `node esbuild.mjs` | Pass — Build complete, dist/extension.js and dist/webview/sidebar.js produced |
| `test -f dist/extension.js` | Pass |
| `npx tsc --project tsconfig.extension.json --noEmit` | Pass — 0 errors |
| package.json has 5 commands | Pass |
| viewsContainers.activitybar has harnesstune-sidebar | Pass |
| views["harnesstune-sidebar"] has type "webview" | Pass |
| tsconfig.extension.json — no DOM | Pass |
| tsconfig.webview.json — has DOM + jsx | Pass |

## Self-Check: PASSED

All 13 source files confirmed on disk. Both task commits (dbfb5e7, 01d7f4a) confirmed in git log. dist/extension.js confirmed present.
