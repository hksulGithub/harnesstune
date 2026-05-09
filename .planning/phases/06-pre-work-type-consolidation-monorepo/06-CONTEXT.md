# Phase 6: Pre-Work — Type Consolidation + Monorepo - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the codebase structurally ready for v2.0 feature work. It delivers:
1. A single canonical `BackendType` definition with `'remote'` added
2. `WorkspaceRecord` with `mode: 'local' | 'remote'` discriminant
3. Registry v1 → v2 migration (transparent, no user action)
4. Monorepo structure with `packages/harnesstune-relay`, `packages/harnesstune-agent`, and `packages/shared`
5. TypeScript project references for cross-package type sharing

No new user-facing features. All existing Milestone 1 functionality must continue working unchanged.

</domain>

<decisions>
## Implementation Decisions

### Package Manager (D-01)
- **D-01:** Use **pnpm workspaces** for the monorepo. Lock this decision in `pnpm-workspace.yaml` at repo root. All subsequent phases use pnpm. Requires `pnpm` installed globally; document in README.

### Shared Types Location (D-02)
- **D-02:** Create a dedicated **`packages/shared`** package for types, constants, and utilities shared across relay, agent CLI, and extension. Build order: `shared` → `relay`/`agent` → extension. Both relay and agent import from `@harnesstune/shared` (or similar workspace package name).

### Registry Migration Strategy (D-03)
- **D-03:** Migrate registry **inline in `load()`**. Check `data.version`, if `1` then transform all records (add `mode: 'local'`), bump version to `2`, and persist. This matches the existing pattern of default fallbacks already in `load()`. No separate migration pipeline.

### Exhaustiveness Enforcement (D-04)
- **D-04:** **Minimal approach — `never` assertion only.** Add a `switch` on `BackendType` in `AdapterRegistry.create()` with a `default: never` case. If someone adds a new `BackendType` without handling it, TypeScript catches it at compile time. Do NOT refactor the `Map<string, AdapterFactory>` registration pattern — keep the existing factory map.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Type Definitions
- `src/types/workspace.ts` — Current `BackendType`, `WorkspaceRecord`, `WorkspaceRegistryData` definitions (lines 1–38). **This is the consolidation target** — AdapterFactory.ts duplicate must be removed.
- `src/types/agent.ts` — `AgentEventType` union pattern (reference for string literal union style)
- `src/types/index.ts` — Re-export barrel file

### Adapter System
- `src/adapters/AdapterFactory.ts` — **Contains duplicate `BackendType`** (line 3). Remove this definition, import from types instead.
- `src/adapters/AdapterRegistry.ts` — Factory registry using `Map<string, AdapterFactory>`. Add exhaustiveness switch here.
- `src/adapters/ClaudeCodeHookAdapter.ts` — Existing adapter implementation
- `src/adapters/OpenClawAdapter.ts` — Existing adapter implementation

### Registry & Persistence
- `src/registry/WorkspaceRegistry.ts` — `load()` (lines 16–46) and `persist()` (lines 127–138). Migration logic goes in `load()`.

### Build Configuration
- `package.json` — Current single-package config; will become root workspace config
- `tsconfig.json` — Current single tsconfig; will become root with project references
- `esbuild.mjs` — Dual-target build (CJS extension + ESM webviews); must continue working after restructure

### Extension Entry
- `src/extension.ts` — Adapter registration (lines 264–267); imports from adapters barrel

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WorkspaceRegistryData.version` field already exists (set to `1`) — migration can check this directly
- `load()` already has a default fallback pattern (`backendType: ws.backendType ?? 'claude-code'`) — migration logic fits naturally here
- `esbuild.mjs` builds 5 bundles in parallel via `Promise.all()` — monorepo build can extend this pattern

### Established Patterns
- **Barrel exports:** `src/types/index.ts` and `src/adapters/index.ts` re-export everything — new packages should follow this
- **Dual tsconfig:** Extension uses CJS, webviews use ESM — root tsconfig.json handles both via `include`/`exclude`
- **String literal unions:** `BackendType`, `WorkspaceStatus`, `AgentEventType` all use `type X = 'a' | 'b'` pattern
- **No existing exhaustiveness checks:** No `never` assertions anywhere in the codebase. Phase 6 introduces this pattern.

### Integration Points
- `src/extension.ts` imports `BackendType` from `./adapters` — after consolidation, import path changes to `@harnesstune/shared` or remains `./types`
- `src/commands/configureWorkspace.ts` uses `BackendType` for backend picker — must pick up consolidated type
- `src/sidebar/`, `src/dashboard/`, `src/schematic/`, `src/chat/` — webview bundles don't import BackendType directly; no changes needed there
- Database schema (`AgentEventStore.ts`) is independent of workspace types — no migration needed

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for pnpm workspace setup, TypeScript project references, and registry migration.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-pre-work-type-consolidation-monorepo*
*Context gathered: 2026-04-19*
