---
status: issues_found
phase: "06"
depth: standard
files_reviewed: 11
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
---

# Code Review: Phase 06

## Summary

Phase 06 establishes a pnpm monorepo with three sub-packages (`shared`, `relay`, `agent`) and consolidates workspace types into `src/types/workspace.ts`. The type definitions are clean and well-documented, the adapter pattern is sound, and the monorepo scaffolding is correct. No critical bugs found. Three warnings relate to duplicated event-handling logic in `extension.ts`, a type-safety gap in `AdapterRegistry`, and a missing `cli.js` entry point declared in `harnesstune-agent`. Three informational notes on minor improvements.

## Findings

### WR-1: Duplicated event pipeline logic in extension.ts

**File:** `src/extension.ts` lines 290-336 vs 611-651
**Severity:** Warning (maintainability / latent bug risk)

The `handleEvent` function (line 290) and the inline callback passed to `ChatManager` (line 611) implement the same 5-step event pipeline (persist, session lifecycle, notifications, dashboard push, schematic push) independently. The `ChatManager` callback is missing PID extraction (lines 301-306 in `handleEvent`). Any future change to the event pipeline must be applied in both places. The `ChatManager` callback should call `handleEvent` directly instead of reimplementing the pipeline.

### WR-2: AdapterRegistry.register accepts `string` but create() expects `BackendType`

**File:** `src/adapters/AdapterRegistry.ts` line 8
**Severity:** Warning (type safety)

`register(backendType: string, ...)` accepts any string, but `create()` switches on `BackendType` (a union of three literals). A typo in a `register()` call would silently succeed at registration time but fail at `create()` time. The parameter should be typed as `BackendType` for compile-time safety:

```ts
register(backendType: BackendType, factory: AdapterFactory): void {
```

### WR-3: harnesstune-agent declares bin entry `dist/cli.js` that does not exist

**File:** `packages/harnesstune-agent/package.json` line 8
**Severity:** Warning (correctness)

The `bin` field maps `harnesstune-agent` to `./dist/cli.js`, but no `cli.ts` source file exists in `packages/harnesstune-agent/src/`. This will cause `npx harnesstune-agent` to fail. This is acceptable if Phase 8 will create it, but the bin entry should not be declared until the source exists (or a stub `cli.ts` should be added now).

### IR-1: `assertNeverBackendType` naming is overly specific

**File:** `src/types/workspace.ts` line 56
**Severity:** Info

The function is a standard exhaustiveness helper. Naming it `assertNever` (generic) would allow reuse for any discriminated union, not just `BackendType`.

### IR-2: Root tsconfig excludes `packages` but references them

**File:** `tsconfig.json` lines 18-23
**Severity:** Info

The `exclude: ["packages"]` prevents the root project from accidentally including package source via glob, while `references` enable project-reference builds. This is correct but worth documenting — a future contributor might wonder why `packages` is excluded yet referenced.

### IR-3: Shared package is a stub with only a version constant

**File:** `packages/shared/src/index.ts`
**Severity:** Info

`@harnesstune/shared` exports only `SHARED_VERSION`. The relay and agent packages import and re-export it, confirming the dependency graph works. The actual type migration from `src/types/` to `shared` is noted as future work — this is fine for a scaffolding phase.

## Files Reviewed

1. `src/types/workspace.ts` — Consolidated type definitions
2. `src/adapters/AdapterFactory.ts` — Factory interface + connection config
3. `src/adapters/AdapterRegistry.ts` — Runtime adapter registry
4. `src/adapters/AgentBackendAdapter.ts` — Adapter interface (supporting file)
5. `src/registry/WorkspaceRegistry.ts` — Persistent workspace registry
6. `src/extension.ts` — Extension entry point
7. `packages/shared/src/index.ts` — Shared package stub
8. `packages/harnesstune-relay/src/index.ts` — Relay package stub
9. `packages/harnesstune-agent/src/index.ts` — Agent package stub
10. `tsconfig.json` — Root TypeScript config with project references
11. `package.json` — Root package with monorepo build scripts
12. `pnpm-workspace.yaml` — Workspace definition
