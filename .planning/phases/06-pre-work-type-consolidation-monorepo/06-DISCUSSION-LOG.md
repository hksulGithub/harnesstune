# Phase 6: Pre-Work — Type Consolidation + Monorepo - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 6-Pre-Work — Type Consolidation + Monorepo
**Areas discussed:** Package Manager, Shared Types Location, Registry Migration, Exhaustiveness Enforcement

---

## Package Manager

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspaces | Fastest installs, strictest dependency isolation, native workspace support. Most popular for TS monorepos. Requires pnpm installed globally. | ✓ |
| npm workspaces | Zero new tooling — npm 7+ has built-in workspace support. Slightly slower installs, less strict hoisting. Already available. | |
| Turborepo + pnpm | Adds build caching and task orchestration on top of pnpm. Overkill for 3 packages but scales well. More config overhead. | |

**User's choice:** pnpm workspaces
**Notes:** None

---

## Shared Types Location

| Option | Description | Selected |
|--------|-------------|----------|
| Separate packages/shared | Dedicated package for types, constants, and utilities shared across relay, agent CLI, and extension. Clean dependency graph. | ✓ |
| Keep in root src/types/ | Types stay in extension's src/types/ and relay/agent use TypeScript project references to import them. Simpler but creates dependency on extension package. | |
| Inline in each package | Each package defines its own copy of shared types. No cross-package dependency. Risk of drift. | |

**User's choice:** Separate packages/shared
**Notes:** None

---

## Registry Migration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in load() | Check version in load(), run migration transforms inline (add mode:'local', bump version to 2). Matches existing pattern. | ✓ |
| Separate migration pipeline | Dedicated MigrationRunner with versioned migration functions. More infrastructure but scales for future changes. | |

**User's choice:** Inline in load()
**Notes:** None

---

## Exhaustiveness Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — never assertion only | Add switch on BackendType in AdapterRegistry.create() with default: never case. Lightweight, meets the requirement. | ✓ |
| Full — typed factory map | Replace Map<string, AdapterFactory> with typed Record<BackendType, AdapterFactory>. More type-safe but requires refactoring registration. | |

**User's choice:** Minimal — never assertion only
**Notes:** None

---

## Claude's Discretion

No areas deferred to Claude's discretion.

## Deferred Ideas

None — discussion stayed within phase scope.
