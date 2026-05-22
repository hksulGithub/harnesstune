---
ticket: v3.1-paperclip-shape-rewrite
priority: high
origin: phase-13-uat (2026-05-09)
blocks: paperclip RunReport ingestion in collector daemon
status: complete
updated: 2026-05-09T04:30:00.000Z
---

## Status (2026-05-09)

All four steps complete. Build passes. Phase 13 UAT re-run green (7/7 tests passing — see `.planning/phases/13-paperclip-adapter/13-HUMAN-UAT.md`). Driver: `.uat-tmp/phase13/driver.mjs`. Live results: 1 company, 4 agents, 1131 heartbeat-runs over 7d window, 86 activity events, all shapes match, status mapping correct (succeeded→success ×980, failed→failure ×151), cost extraction correct (`costUsd=0.1995… → costCents=20`).

Decisions made during rewrite:
- **Schedule derivation**: `runtimeConfig.heartbeat.intervalSec / 60 → */N * * * *` only when divisible by 60; otherwise null. Sub-minute intervals are not representable as standard cron and don't fit the daemon's stale-detection logic anyway.
- **Cost enrichment**: `enrichWithCosts` removed entirely. Per-run cost now comes from `usageJson.costUsd` on each `PaperclipHeartbeatRun` (round to costCents). The aggregated `getCostsByAgent` method is kept on the client for other potential uses but is no longer called in `collectRuns`.
- **Task definitions**: `getTaskDefinitions(companyId, agentId)` probes `/api/companies/{cid}/task-definitions` first, falls back to `/api/companies/{cid}/task-sessions` on 404. Not yet wired into `collectRuns` — consumed only if a future feature needs definition metadata.
- **Run endpoint**: confirmed canonical name is **heartbeat-runs**: `/api/companies/{cid}/heartbeat-runs?agentId={aid}&since={iso}` (not `/api/agents/{id}/runs` or any of the other guesses).
- **Status mapping**: `succeeded → success`, `failed → failure`, `running → running`. Translated in `mapHeartbeatRun`.
- **Activity field renames**: `eventType → action`, `occurredAt → createdAt`, `detail → details` (and `details` is now an object — rendered as `JSON.stringify` in the logExcerpt).

# Paperclip API Shape Rewrite

## Why

Phase 13 was implemented against assumed Paperclip API types that turned out to diverge significantly from the real local server (probed 2026-05-09 at `http://localhost:3100`). The setup wizard works, but the collector daemon will fail or produce malformed RunReports when it polls. v3.0 ships with Phase 13 flagged as known-broken on shape.

## Scope

### 1. Probe missing endpoints

Find where actual run-execution data lives. Candidates to probe:
- `/api/runs/{lastRunId}`
- `/api/agents/{id}/runs`
- `/api/companies/{companyId}/runs`

The `lastRunId` field on agents and on task-sessions is the breadcrumb. A task-session is a task definition (a recurring agent task), not a single execution. We need the per-run record with `startedAt`, `finishedAt`, `costCents`, token counts, and status.

### 2. Rewrite `packages/harnesstune-collector/src/plugins/paperclip/types.ts`

Replace the four interfaces against the real shapes:

**PaperclipAgent** — real fields: `id, companyId, name, role, title, status, capabilities, adapterType, adapterConfig, runtimeConfig, lastHeartbeatAt`. No `schedule`, no `lastRunAt`. Decide where (if anywhere) `schedule` comes from — possibly `runtimeConfig` or a separate endpoint.

**PaperclipTaskSession** — currently used as if it were a run execution. Either:
- Repurpose as a task-definition type and rename → `PaperclipTaskDefinition` (`taskKey, sessionParamsJson, sessionDisplayId, lastRunId, lastError, createdAt, updatedAt`)
- Add a separate `PaperclipRun` type for the actual execution record (shape TBD until endpoint probe completes)

**PaperclipCostEntry** — real fields: `agentId, agentName, agentStatus, costCents, inputTokens, outputTokens, apiRunCount, subscriptionRunCount, subscriptionInputTokens, subscriptionOutputTokens`. Aggregated, no per-day `date`. Decide whether the daemon's cost-enrichment use case actually needs per-day breakdowns — if yes, find the right endpoint; if no, drop the `date` field.

**PaperclipActivity** — rename fields: `eventType` → `action`, `occurredAt` → `createdAt`, `detail` → `details`. Otherwise shape-compatible.

### 3. Rewrite `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts`

- `mapTaskSession` → likely needs replacement with `mapRun` against the real run endpoint shape.
- `enrichWithCosts` → reconcile aggregated cost data with per-run RunReports (one cost row spans many runs over the range). May need to switch from "patch per-run cost" to "use aggregate as the cost number" or find a per-run cost endpoint.
- `mapActivitiesToEvents` → field renames only.
- `mapAgent` → drop `schedule`/`lastRunAt`, source from `lastHeartbeatAt` and (probably) `runtimeConfig`.

### 4. Re-run Phase 13 UAT

Tests 1–4 reopened. Test 5 already passed and stays.

## Notes

- The setup wizard fix (readline injection + ownsRl pattern across 3 plugins) is correct and stays in v3.0.
- The adaptive raw-array-or-envelope handler in `getAll<T>` is correct and stays in v3.0.
- Do NOT rewrite either of those. They are real wins.

## Deferred decisions

- Which Paperclip deployment is canonical (the local dev server's shapes might differ from a production deployment) — get clarity from Paperclip team or from one production probe before committing to types.
- Whether to model task-definitions and run-executions as two separate harnesstune concepts, or fold both into RunReport. Lean toward two concepts: AgentIdentity already covers the "definition" side; RunReport stays as "execution".
