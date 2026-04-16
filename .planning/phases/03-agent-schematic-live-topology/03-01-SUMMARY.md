---
phase: 03-agent-schematic-live-topology
plan: "01"
subsystem: topology-data-layer
tags: [topology, d3-hierarchy, types, reducer, sqlite, webview-shared]
dependencies:
  requires: []
  provides: [TopologyNode, TopologyEdge, TopologyState, buildTopology, AgentDetailPanel-shared]
  affects: [03-02-PLAN.md, 03-03-PLAN.md]
tech_stack:
  added: [d3-hierarchy@3.1.2, "@types/d3-hierarchy@3.1.7"]
  patterns: [pure-reducer, d3-tree-layout, esm-jest-transform, shared-component-re-export]
key_files:
  created:
    - src/types/topology.ts
    - src/topology/topologyReducer.ts
    - src/topology/index.ts
    - tests/topology/topologyReducer.test.ts
    - src/webview/shared/components/AgentDetailPanel.tsx
  modified:
    - src/types/agent.ts
    - src/types/messages.ts
    - src/types/index.ts
    - src/database/AgentEventStore.ts
    - src/adapters/ClaudeCodeHookAdapter.ts
    - package.json
    - jest.config.js
    - src/webview/dashboard/components/AgentDetailPanel.tsx
decisions:
  - "d3-hierarchy nodeSize([160, 80]): 160px horizontal, 80px vertical per UI-SPEC D-05"
  - "fallback parentSessionId resolution uses most-recently-created running node in same workspace when parentToolUseId is unavailable"
  - "jest.config.js transformIgnorePatterns updated to include d3-hierarchy for ESM->CJS transformation in test runner"
  - "AgentDetailPanel shared via re-export: dashboard imports unchanged, shared component is the source of truth"
  - "SQLite migration uses try/catch around ALTER TABLE for idempotent column addition to existing databases"
metrics:
  duration: "3 min"
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_created: 5
  files_modified: 8
---

# Phase 03 Plan 01: Topology Data Layer Summary

**One-liner:** Topology types (TopologyNode/Edge/State), pure buildTopology reducer with d3-hierarchy tree layout, AgentEvent+SQLite extended with parentToolUseId, shared AgentDetailPanel with showControls prop, and schematic message types added.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Topology types, AgentEvent extension, SQLite migration, adapter parentToolUseId | 4107f7c | src/types/topology.ts, src/types/agent.ts, src/types/messages.ts, src/database/AgentEventStore.ts, src/adapters/ClaudeCodeHookAdapter.ts, package.json |
| 2 | topologyReducer pure function, shared AgentDetailPanel extraction | 47974b2 | src/topology/topologyReducer.ts, tests/topology/topologyReducer.test.ts, src/webview/shared/components/AgentDetailPanel.tsx |

## What Was Built

### Topology Types (`src/types/topology.ts`)
Three interfaces: `TopologyNode` (sessionId, parentSessionId, workspaceId, agentRole, model, status, opacity, x, y, startedAt, stoppedAt), `TopologyEdge` (id, sourceSessionId, targetSessionId, isActive, status), `TopologyState` (nodes, edges). Exported from `src/types/index.ts`.

### AgentEvent Extension (`src/types/agent.ts`)
Added `parentToolUseId?: string` and `parentSessionId?: string` to the `AgentEvent` interface.

### Message Types (`src/types/messages.ts`)
Added to `HostToWebviewMessage`: `schematic:topologyUpdate`, `schematic:nodeUpdate`, `schematic:nodeDetail`. Added to `WebviewToHostMessage`: `schematic:requestState`, `schematic:selectNode`. The `schematic:nodeDetail` message is the dedicated response for click-to-inspect: it carries the selected node's `AgentSession` and `AgentEvent[]` to the webview.

### SQLite Schema (`src/database/AgentEventStore.ts`)
- Added `parent_tool_use_id TEXT` column to CREATE TABLE schema
- Added idempotent migration (try/catch ALTER TABLE) for existing databases
- Updated `insertEvent()` to persist `parentToolUseId`
- Updated `rowToEvent()` to deserialize `parent_tool_use_id` → `parentToolUseId`
- Added `getHierarchyEvents(workspaceId)` returning only SessionStart/End/SubagentStart/Stop events ordered by timestamp ASC

### Adapter (`src/adapters/ClaudeCodeHookAdapter.ts`)
`normalizeEvent()` now extracts `parentToolUseId` from both `parent_tool_use_id` (snake_case raw) and `parentToolUseId` (camelCase) fields.

### topologyReducer (`src/topology/topologyReducer.ts`)
Pure function `buildTopology(events, workspaceFilter?)` with four steps:
- A: Build node map from events (dedup on sessionId, fallback parentSessionId resolution)
- B: Build edges from parent-child relationships
- C: Compute positions via `d3.tree().nodeSize([160, 80])`, multiple roots offset by 200px gap
- D: Return `{ nodes, edges }`

### Tests (`tests/topology/topologyReducer.test.ts`)
8 tests covering: empty input, single root, parent-child with edge, SubagentStop, SessionEnd cascade, independent sessions, dedup, y-coordinate ordering.

### Shared AgentDetailPanel (`src/webview/shared/components/AgentDetailPanel.tsx`)
Full component moved to shared location with optional `showControls?: boolean` prop (default `true`). When `showControls=false`, ControlButtons are omitted — for use in the read-only schematic panel. Dashboard re-exports from shared for backward compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] d3-hierarchy ESM module fails in Jest test runner**
- **Found during:** Task 2
- **Issue:** d3-hierarchy v3 ships as pure ESM. Jest uses CommonJS by default and could not parse the `export` syntax.
- **Fix:** Added `transformIgnorePatterns` to `jest.config.js` to include `d3-hierarchy` in the transform pipeline, with `.m?js` files also processed by ts-jest.
- **Files modified:** `jest.config.js`
- **Commit:** 47974b2

## Verification Results

- `npx jest tests/topology/` — 8/8 tests pass
- `npx tsc --noEmit -p tsconfig.extension.json` — clean
- `npx tsc --noEmit -p tsconfig.webview.json` — clean
- `node esbuild.mjs` — build complete

## Self-Check: PASSED

All key files present. Both commits verified in git log. TypeScript clean, 8 tests pass, esbuild succeeds.
