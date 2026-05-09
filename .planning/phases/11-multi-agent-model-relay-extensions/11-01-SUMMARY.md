---
phase: 11-multi-agent-model-relay-extensions
plan: 01
status: complete
started: 2026-04-23T00:00:00Z
completed: 2026-04-23T00:30:00Z
---

## Summary

Added the `RunReport` shared type and `RunStatus` type alias to `@harnesstune/shared`, extended the relay Drizzle schema with `agents` and `agent_runs` tables plus a nullable `agentId` column on `reports`, and implemented five new relay endpoints covering agent registration, run history upload and retrieval, and per-agent summary aggregation. The reports GET endpoint now accepts an optional `?agentId` filter and POST stores `agentId` from the request body.

## Tasks Completed

1. **Add RunReport shared type and extend relay Drizzle schema** — Added `RunReport` interface, `RunStatus` type, and `agentId?` to `ReportEnvelope` in shared; added `agents` and `agentRuns` tables plus `agentId` column on `reports` table in schema.ts
2. **Create relay route files and extend existing reports endpoint** — Created agents.ts, runs.ts, summary.ts route files; extended reports.ts with agentId support; mounted all new routes in app.ts

## Key Files

### Created
- `packages/harnesstune-relay/src/routes/agents.ts`
- `packages/harnesstune-relay/src/routes/runs.ts`
- `packages/harnesstune-relay/src/routes/summary.ts`

### Modified
- `packages/shared/src/reports.ts`
- `packages/harnesstune-relay/src/db/schema.ts`
- `packages/harnesstune-relay/src/routes/reports.ts`
- `packages/harnesstune-relay/src/app.ts`

## Self-Check

PASSED

- `export interface RunReport` present in shared/reports.ts
- `export type RunStatus = RunReport['status']` present
- `ReportEnvelope` has `agentId?: string`
- `export const agents = sqliteTable('agents'` present in schema.ts
- `export const agentRuns = sqliteTable('agent_runs'` present in schema.ts
- `agentId: text('agent_id')` present in reports table (nullable, backward compatible)
- All 5 new endpoints implemented with channelId auth checks
- `pnpm --filter @harnesstune/shared run build` exits 0
- `pnpm --filter @harnesstune/relay run build` exits 0
- All plan verification commands pass

## Deviations

None

## Issues

None — the worktree's `packages/` directory shares the filesystem with the main repo (git worktree behavior), so builds were run from the main repo path where `node_modules` are installed; the worktree git index tracked the file changes correctly.
