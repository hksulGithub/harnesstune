---
phase: 05-workspace-scaffolding-openclaw-adapter
plan: "01"
subsystem: adapters
tags: [adapter-pattern, factory, registry, types, workspace, openclaw]
dependency_graph:
  requires: []
  provides: [AdapterRegistry, AdapterFactory, BackendType, WorkspaceConnectionConfig, OpenClawEvent, per-workspace-adapter-routing]
  affects: [src/extension.ts, src/registry/WorkspaceRegistry.ts, src/types/workspace.ts]
tech_stack:
  added: []
  patterns: [factory-pattern, registry-pattern, per-workspace-adapter-routing]
key_files:
  created:
    - src/types/openclaw.ts
    - src/adapters/AdapterFactory.ts
    - src/adapters/AdapterRegistry.ts
    - tests/adapters/AdapterRegistry.test.ts
  modified:
    - src/adapters/index.ts
    - src/types/workspace.ts
    - src/types/index.ts
    - src/registry/WorkspaceRegistry.ts
    - src/extension.ts
    - package.json
decisions:
  - "AdapterFactory interface uses createAdapter(config) not createAdapter() — config carries backendType, host, port for multi-backend routing"
  - "WorkspaceRegistry.load() migrates existing records with backendType ?? 'claude-code' — backward-compatible, no data loss"
  - "claudeCodeAdapter registered as singleton via lambda closure — two create() calls return same instance by design"
  - "handleEvent() extracted as named function shared by claudeCodeAdapter and future per-workspace adapters from connectWorkspace()"
  - "activeAdapters Map keyed by workspace.id — connectWorkspace() is idempotent, guards with has() check"
metrics:
  duration: "4 min"
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_changed: 10
---

# Phase 05 Plan 01: Adapter Factory Pattern + OpenClaw Type Contracts Summary

**One-liner:** Adapter factory registry with per-workspace routing, BackendType/WorkspaceConnectionConfig/OpenClawEvent type contracts, and WorkspaceRecord backendType migration.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Type contracts — BackendType, AdapterFactory, AdapterRegistry, OpenClawEvent + WorkspaceRecord migration | 0c667b1 | src/types/openclaw.ts, src/adapters/AdapterFactory.ts, src/adapters/AdapterRegistry.ts, src/adapters/index.ts, src/types/workspace.ts, src/types/index.ts, src/registry/WorkspaceRegistry.ts, tests/adapters/AdapterRegistry.test.ts |
| 2 | Refactor extension.ts — replace single adapter with AdapterRegistry + per-workspace active adapters map | 054aef6 | src/extension.ts, package.json |

## What Was Built

**Task 1 (TDD):** Created the full adapter factory type system:
- `src/types/openclaw.ts` — `OpenClawEvent` interface (HarnessTune v1 integration spec for JSONL-based agent backends)
- `src/adapters/AdapterFactory.ts` — `BackendType` union (`'claude-code' | 'openclaw'`), `WorkspaceConnectionConfig`, `AdapterFactory` interface
- `src/adapters/AdapterRegistry.ts` — `AdapterRegistry` class with `register(backendType, factory)` and `create(config)` — throws descriptive error for unregistered backends
- Extended `WorkspaceRecord` with `backendType: BackendType` and optional `connectionConfig`
- Updated `IWorkspaceRegistry.add()` to accept optional `backendType` parameter
- `WorkspaceRegistry.load()` now migrates persisted records with `backendType ?? 'claude-code'`
- 3 tests: register+create, unregistered-throws, singleton-identity — all passing

**Task 2:** Refactored `extension.ts` from a single shared `ClaudeCodeHookAdapter` to factory-based per-workspace routing:
- `AdapterRegistry` instantiated at activation with claude-code factory registered
- `handleEvent()` extracted as a named shared function (previously inline lambda)
- `connectWorkspace(workspace)` async function — idempotent, routes by `workspace.backendType`, stores active adapter in `activeAdapters` Map
- Auto-connect loop and `onDidChange` handler both use `connectWorkspace()` instead of `adapter.connect()`
- Added `harnesstune.configureWorkspace` stub command
- Added `harnesstune.createWorkspace` and `harnesstune.configureWorkspace` to `package.json` contributes

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

- **AdapterFactory singleton via closure:** The plan specifies claude-code factory returns the same `claudeCodeAdapter` instance. This is implemented via `{ createAdapter: () => claudeCodeAdapter }` — the closure captures the singleton, so `registry.create()` always returns the same object. Test 3 verifies identity (`===`).
- **AgentBackendAdapter type import:** Added `AgentBackendAdapter` to the type imports from `./adapters` in extension.ts to type the `activeAdapters` Map correctly.
- **handleEvent before connectWorkspace:** The extracted `handleEvent` function must be declared before `connectWorkspace` which captures it — this ordering constraint was respected.

## Verification

- `npx jest --testPathPatterns="AdapterRegistry" --no-coverage` — 3/3 tests pass
- `npm run build` — compiles cleanly (WASM copy warning is pre-existing, unrelated)
- `grep backendType src/types/workspace.ts` — field present in WorkspaceRecord
- `grep adapterRegistry src/extension.ts` — factory pattern in use

## Self-Check: PASSED

- src/types/openclaw.ts — FOUND
- src/adapters/AdapterFactory.ts — FOUND
- src/adapters/AdapterRegistry.ts — FOUND
- tests/adapters/AdapterRegistry.test.ts — FOUND
- Commit 0c667b1 — FOUND
- Commit 054aef6 — FOUND
