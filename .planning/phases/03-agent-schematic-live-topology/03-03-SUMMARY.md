---
phase: 03-agent-schematic-live-topology
plan: 03
status: complete
completed: "2026-04-17"
---

# Plan 03-03 Summary: Extension Wiring + Human Verification

## What was done

### Task 1: Extension.ts schematic wiring (auto)
- Added `SchematicPanel` and `buildTopology` imports
- Registered `harnesstune.showSchematic` command → opens SchematicPanel
- Added `WebviewPanelSerializer` for `harnesstune.schematic` viewType (D-20)
- Added `wireSchematicMessageHandler` function:
  - `schematic:requestState` → rebuilds full topology from stored hierarchy events, sends `schematic:topologyUpdate` + `workspaces:update`
  - `schematic:selectNode` → looks up session + events, sends `schematic:nodeDetail` for click-to-inspect
- Added real-time event push to schematic in `onAdapterEvent` callback (rebuild topology on each hook event)
- Added session state change push to schematic in `onSessionChange` callback

### Task 2: Human verification (checkpoint)
- **Checkpoint 1 (schematic opens)**: PASS — "HarnessTune: Show Agent Schematic" opens panel, empty state shows "No agents running"
- **Checkpoints 2–8**: Not testable — require live multi-agent Claude Code sessions with hook events. Deferred to integration testing when live agents are available.

## Verification
- `npx tsc --noEmit -p tsconfig.extension.json` — clean
- `npx tsc --noEmit -p tsconfig.webview.json` — clean
- `node esbuild.mjs` — all 4 bundles build
- All plan verification greps pass (SchematicPanel ×10, buildTopology ×4, schematic:selectNode ×1, schematic:nodeDetail ×2, serializer ×1, getHierarchyEvents ×3)

## Files modified
- `src/extension.ts` — +93 lines (schematic command, serializer, event pipeline, message handler)

## Commit
- `24a0868` — Phase 03 Plan 03 Task 1: Wire SchematicPanel into extension host
