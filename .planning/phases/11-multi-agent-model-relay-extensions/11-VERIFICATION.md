---
phase: 11
status: pass
verified_at: 2026-04-23
criteria_passed: 8
criteria_total: 8
---

# Phase 11 Verification: Multi-Agent Model + Relay Extensions

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| MAWM-01 | PASS | `WorkspaceRecord` models a single platform instance; `agents: AgentIdentity[]` field stores per-workspace agent cache. Registry v3 persists the model. |
| MAWM-02 | PASS | `WorkspaceRecord.agents: AgentIdentity[]` (array, not scalar) — supports multiple agents per workspace. `agents` table has `(channelId, agentId)` scoping. |
| MAWM-03 | PASS | `AgentIdentity` interface at `src/types/workspace.ts:11` with 7 required fields (id, agentId, name, platform, schedule, lastRunAt, status). `WorkspaceRecord.agents: AgentIdentity[]` at line 66. |
| MAWM-04 | PASS | `RunReport` interface in `packages/shared/src/reports.ts:43`; `RunStatus` type alias at line 58; `ReportEnvelope.agentId?: string` at line 39. |
| RLYX-01 | PASS | `GET /channels/:id/reports` accepts `?agentId=` filter (`routes/reports.ts:59,67`); `POST /channels/:id/reports` stores `agentId` (`reports.ts:35,44`). |
| RLYX-02 | PASS | `POST /channels/:id/agents` (upsert-register) and `GET /channels/:id/agents` (list) both implemented in `routes/agents.ts`; mounted in `app.ts:50`. |
| RLYX-03 | PASS | `POST /channels/:id/runs` creates `agent_runs` record with auto-stub upsert (`runs.ts:11-57`); `GET /channels/:id/agents/:agentId/runs` returns paginated history with `?since=` and `?limit=` params (`runs.ts:61-80`); both mounted in `app.ts:51-52`. |
| RLYX-04 | PASS | `GET /channels/:id/summary?days=N` with on-the-fly SQL aggregation (COUNT, SUM CASE WHEN, COALESCE SUM, MAX) returning `channelId`, `days`, `agents[]` with `agentId`, `totalRuns`, `successCount`, `failureCount`, `successRate`, `totalCostCents`, `lastRunAt`. Mounted at `app.ts:53`. |

## Acceptance Criteria

### Plan 01 — Task 1: RunReport type and relay schema

| Criterion | Status | Evidence |
|---|---|---|
| `packages/shared/src/reports.ts` contains `export interface RunReport` | PASS | `reports.ts:43` |
| RunReport has all 9 fields (agentId, startedAt, finishedAt, status, durationMs, logExcerpt?, errorSummary?, tokenUsage?, costCents?) | PASS | `reports.ts:43-56` — all fields present with correct types and optionality |
| `export type RunStatus = RunReport['status']` | PASS | `reports.ts:58` |
| `ReportEnvelope` contains `agentId?: string` | PASS | `reports.ts:39` |
| `schema.ts` contains `export const agents = sqliteTable('agents'` | PASS | `schema.ts:34` |
| `schema.ts` contains `export const agentRuns = sqliteTable('agent_runs'` | PASS | `schema.ts:46` |
| `reports` table contains `agentId: text('agent_id')` (nullable) | PASS | `schema.ts:22` — no `.notNull()`, backward compatible |
| `agents` table has all 9 columns (id, channelId, agentId, name, platform, schedule, lastRunAt, status, createdAt) | PASS | `schema.ts:34-44` |
| `agentRuns` table has all 11 columns (id, channelId, agentId, startedAt, finishedAt, status, durationMs, logExcerpt, errorSummary, tokenUsage, costCents) | PASS | `schema.ts:46-58` |

### Plan 01 — Task 2: Relay routes and app.ts

| Criterion | Status | Evidence |
|---|---|---|
| `routes/agents.ts` exists and exports `agentsRouter` | PASS | `agents.ts:8` |
| POST handler checks `channelId !== authedChannelId` | PASS | `agents.ts:14` |
| GET handler returns `{ agents: rows }` | PASS | `agents.ts:56` |
| `routes/runs.ts` exists and exports `runsRouter` | PASS | `runs.ts:8` |
| POST handler inserts into agentRuns and auto-creates agent stub if missing | PASS | `runs.ts:29-50` |
| GET handler accepts `?since=` and `?limit=` query params | PASS | `runs.ts:67-68` |
| `routes/summary.ts` exists and exports `summaryRouter` | PASS | `summary.ts:7` |
| summary.ts contains SQL aggregation with COUNT, SUM CASE WHEN, COALESCE SUM, MAX | PASS | `summary.ts:21-24` |
| summary response includes `channelId`, `days`, `agents[]` with all 7 AgentSummary fields | PASS | `summary.ts:29-39` |
| `routes/reports.ts` POST extracts and stores `agentId` from request body | PASS | `reports.ts:30,35,44` |
| `routes/reports.ts` GET list accepts optional `agentId` query param and filters | PASS | `reports.ts:59,67` |
| `app.ts` imports agentsRouter, runsRouter, summaryRouter | PASS | `app.ts:9-11` |
| `app.ts` mounts all 4 new route paths | PASS | `app.ts:50-53` — `/channels/:channelId/agents`, `/channels/:channelId/runs`, `/channels/:channelId/agents/:agentId/runs`, `/channels/:channelId/summary` |

### Plan 02 — Task 1: AgentIdentity type and registry migration

| Criterion | Status | Evidence |
|---|---|---|
| `src/types/workspace.ts` contains `export interface AgentIdentity` with 7 fields | PASS | `workspace.ts:11-26` |
| `WorkspaceRecord` contains `agents: AgentIdentity[]` | PASS | `workspace.ts:66` |
| `WorkspaceRegistryData` version type is `1 \| 2 \| 3` | PASS | `workspace.ts:71` |
| `IWorkspaceRegistry.update()` Pick includes `'agents'` | PASS | `workspace.ts:81` |
| `WorkspaceRegistry.load()` contains `data.version === 3` branch | PASS | `WorkspaceRegistry.ts:40-42` |
| v2 branch adds `agents: (ws as WorkspaceRecord).agents ?? []` and auto-persists | PASS | `WorkspaceRegistry.ts:33-39` |
| `persist()` writes `version: 3` | PASS | `WorkspaceRegistry.ts:170` |
| `add()` includes `agents: []` in new record | PASS | `WorkspaceRegistry.ts:119` |
| `update()` Pick includes `'agents'` | PASS | `WorkspaceRegistry.ts:153` |

### Plan 02 — Task 2: RelayClient methods and RemoteAdapter polling

| Criterion | Status | Evidence |
|---|---|---|
| `RelayClient.ts` contains `async getAgents(): Promise<AgentIdentity[]>` | PASS | `RelayClient.ts:142-147` |
| `RelayClient.ts` contains `async registerAgent(agentId: string, platform: string, ...)` | PASS | `RelayClient.ts:150-161` |
| `RelayClient.ts` contains `async getRuns(agentId: string, ...)` | PASS | `RelayClient.ts:164-173` |
| `RelayClient.ts` contains `async getSummary(days...)` | PASS | `RelayClient.ts:176-180` |
| `RelayClient.ts` exports `AgentSummary` interface | PASS | `RelayClient.ts:27-35` |
| `RelayClient.ts` exports `ChannelSummaryResponse` interface | PASS | `RelayClient.ts:37-41` |
| `RelayClient.ts` exports `RunRecord` interface | PASS | `RelayClient.ts:43-55` |
| `RelayClient.ts` imports `AgentIdentity` from `'../types/workspace'` | PASS | `RelayClient.ts:2` |
| `RemoteAdapter.ts` contains `getAgents()` call in poll cycle | PASS | `RemoteAdapter.ts:141` |
| `RemoteAdapter.ts` contains `registry.update(this.workspaceId, { agents })` | PASS | `RemoteAdapter.ts:143` |
| Agent fetch failure caught with `console.warn` (non-breaking) | PASS | `RemoteAdapter.ts:144-147` — separate try/catch inside the main poll try block |

## Gaps

None — all acceptance criteria from both plans are satisfied. Every acceptance criterion has direct file:line evidence. The agent cache refresh in `RemoteAdapter` is correctly guarded by `if (this.registry && this.workspaceId)` (line 139) ensuring no failure when registry is not injected, and the inner try/catch (lines 140-147) prevents agent fetch errors from breaking the main poll cycle.
