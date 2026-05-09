---
phase: 06-pre-work-type-consolidation-monorepo
plan: 01
subsystem: types, adapters, registry
tags: [type-consolidation, migration, exhaustiveness]
dependency_graph:
  requires: []
  provides: [BackendType-canonical, WorkspaceMode, registry-v2, assertNeverBackendType]
  affects: [adapters, registry, extension-commands]
tech_stack:
  added: []
  patterns: [never-assertion-exhaustiveness, inline-registry-migration]
key_files:
  created: []
  modified:
    - src/types/workspace.ts
    - src/adapters/AdapterFactory.ts
    - src/adapters/AdapterRegistry.ts
    - src/registry/WorkspaceRegistry.ts
    - src/extension.ts
    - tests/notifications/NotificationService.test.ts
decisions:
  - "assertNeverBackendType as standalone function in types/workspace.ts for reuse across codebase"
  - "v1 migration auto-persists on first load to avoid repeated migration checks"
metrics:
  duration: "2 min"
  completed: "2026-04-19T06:47:38Z"
---

# Phase 6 Plan 01: Type Consolidation + Registry v2 Migration Summary

Canonical BackendType with 'remote' variant, WorkspaceMode discriminant, registry v1-to-v2 inline migration, exhaustive switch in AdapterRegistry.

## Tasks Completed

### Task 1: Consolidate BackendType, add mode discriminant, update WorkspaceRegistryData to v2
**Commit:** 3ed25b6

- `BackendType` consolidated to single definition in `src/types/workspace.ts` with `'remote'` added
- `WorkspaceMode = 'local' | 'remote'` type added
- `mode: WorkspaceMode` field added to `WorkspaceRecord`
- `WorkspaceRegistryData.version` widened to `1 | 2`
- `assertNeverBackendType(x: never): never` utility added
- `AdapterFactory.ts` duplicate `BackendType` removed; re-exports from types
- `AdapterRegistry.create()` uses exhaustive switch with `assertNeverBackendType` on default

### Task 2: Registry v1-to-v2 migration and update all consumers
**Commit:** 92d54bb

- `load()` detects `data.version === 1` and migrates records (adds `mode: 'local'`), then auto-persists as v2
- `load()` handles `version === 2` normally, throws on unknown versions
- `persist()` writes `version: 2`
- `add()` defaults new records to `mode: 'local'`
- `update()` signature accepts `'mode'` field (both interface and implementation)
- Extension `configureWorkspace` quickpick includes Remote backend option
- Test fixture (`NotificationService.test.ts`) updated with `mode: 'local'`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test fixture missing mode property**
- **Found during:** Task 2 verification
- **Issue:** `tests/notifications/NotificationService.test.ts` creates a `WorkspaceRecord` literal without the new `mode` field, causing TS2741
- **Fix:** Added `mode: 'local' as const` to the test fixture
- **Files modified:** `tests/notifications/NotificationService.test.ts`
- **Commit:** 92d54bb

## Verification Results

- `npx tsc --noEmit`: All new code compiles clean (4 pre-existing errors in unrelated files remain)
- `node esbuild.mjs`: "Build complete" -- all 5 bundles succeed
- `grep -rn "export type BackendType" src/`: exactly 1 result in `src/types/workspace.ts`
- `grep -n "mode:" src/types/workspace.ts`: `mode: WorkspaceMode` present
- `grep -n "version: 2" src/registry/WorkspaceRegistry.ts`: persist writes v2

## Pre-existing Issues (Not Fixed)

4 TypeScript errors exist in unrelated files (extension.ts:662, ChatManager.ts:160, SidebarViewProvider.ts:42-43). These are pre-existing and unrelated to this plan's changes. Logged but not fixed per scope boundary rules.
