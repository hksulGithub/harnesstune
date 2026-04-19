---
phase: 06-pre-work-type-consolidation-monorepo
plan: 02
subsystem: monorepo, build
tags: [pnpm-workspaces, typescript-project-references, monorepo]
dependency_graph:
  requires: [06-01]
  provides: [pnpm-monorepo, workspace-packages, ts-project-references]
  affects: [build-pipeline, package-imports]
tech_stack:
  added: [pnpm-workspaces]
  patterns: [composite-tsconfig, workspace-protocol]
key_files:
  created:
    - pnpm-workspace.yaml
    - packages/shared/package.json
    - packages/shared/tsconfig.json
    - packages/shared/src/index.ts
    - packages/harnesstune-relay/package.json
    - packages/harnesstune-relay/tsconfig.json
    - packages/harnesstune-relay/src/index.ts
    - packages/harnesstune-agent/package.json
    - packages/harnesstune-agent/tsconfig.json
    - packages/harnesstune-agent/src/index.ts
    - pnpm-lock.yaml
  modified:
    - tsconfig.json
    - package.json
decisions:
  - "Root package included as workspace member via '.' in pnpm-workspace.yaml"
  - "build:packages script chains tsc --build in dependency order before esbuild"
metrics:
  duration: "1 min"
  completed: "2026-04-19T06:52:09Z"
---

# Phase 6 Plan 02: pnpm Monorepo + TypeScript Project References Summary

pnpm workspaces with 4 members (root, shared, relay, agent), composite TypeScript project references compiling shared -> relay/agent -> extension, build:packages chained before esbuild.

## Tasks Completed

### Task 1: Create pnpm workspace config and scaffold package directories
**Commit:** 37c20d0

- Created `pnpm-workspace.yaml` with root `"."` and `"packages/*"` globs
- Scaffolded `packages/shared` with `@harnesstune/shared` package, composite tsconfig, stub index.ts
- Scaffolded `packages/harnesstune-relay` with `@harnesstune/relay` package, workspace dependency on shared, tsconfig referencing shared
- Scaffolded `packages/harnesstune-agent` with `@harnesstune/agent` package, bin entry for CLI, workspace dependency on shared, tsconfig referencing shared

### Task 2: Configure root TypeScript project references and verify full build
**Commit:** ca4fcc0

- Root `tsconfig.json` updated: `composite: true`, `"packages"` added to exclude, project references to all 3 packages
- Root `package.json` updated: `build:packages` script runs `tsc --build` on packages in dependency order, `build` script chains `build:packages && node esbuild.mjs`
- `pnpm install` linked workspace packages successfully
- `pnpm run build` verified: tsc --build compiles all 3 packages, esbuild produces all 5 extension bundles
- All package dist outputs verified: `packages/shared/dist/index.js`, `packages/harnesstune-relay/dist/index.js`, `packages/harnesstune-agent/dist/index.js`

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `pnpm install`: exits 0, workspace packages linked
- `pnpm run build`: exits 0, "Build complete" printed
- `tsc --build packages/shared packages/harnesstune-relay packages/harnesstune-agent`: zero errors
- `node esbuild.mjs`: all 5 bundles + sql-wasm.wasm copied
- All 3 package dist/index.js files exist with declarations

## Self-Check: PASSED

- pnpm-workspace.yaml: FOUND
- packages/shared/package.json: FOUND
- packages/shared/tsconfig.json: FOUND
- packages/shared/src/index.ts: FOUND
- packages/harnesstune-relay/package.json: FOUND
- packages/harnesstune-relay/tsconfig.json: FOUND
- packages/harnesstune-relay/src/index.ts: FOUND
- packages/harnesstune-agent/package.json: FOUND
- packages/harnesstune-agent/tsconfig.json: FOUND
- packages/harnesstune-agent/src/index.ts: FOUND
- Commit 37c20d0: FOUND
- Commit ca4fcc0: FOUND
