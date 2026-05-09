# Phase 11 Context: Multi-Agent Model + Relay Extensions

**Created:** 2026-04-22
**Phase:** 11 — Multi-Agent Model + Relay Extensions
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 06**: `BackendType = 'claude-code' | 'openclaw' | 'remote'`, `WorkspaceMode = 'local' | 'remote'` discriminant, pnpm monorepo with `packages/shared`, registry versioned (v1→v2 migration pattern in `WorkspaceRegistry.load()`)
- **Phase 07**: Relay API on Vercel + Turso, Bearer token auth (SHA-256 hash + timingSafeEqual), rate limiting (60 req/min per token), Drizzle ORM schema with `channels`, `tokens`, `reports`, `messages`, `rateLimits` tables
- **Phase 08**: `ReportEnvelope` with `BriefingReportBody`, `RalphReportBody`, `HeartbeatReportBody` in `@harnesstune/shared`; Agent CLI uploads reports/heartbeats to relay
- **Phase 09**: `RemoteAdapter` polls on 30s interval with exponential backoff; `RelayClient` wraps relay HTTP; per-workspace token in SecretStore; sentinel rootPath `remote://{channelId}`
- **Phase 10**: `ReportPanel` singleton pattern; `TimelineItem` union type (`report | message | activity`); heartbeats filtered from timeline; extension host merges reports + messages into unified feed

## Decisions

### D-01: Two-table schema — `agent_runs` + `reports` with `agentId`

Two separate data entities coexist in the relay:

1. **`agent_runs` table** (new) — structured execution records from the collector daemon. Fields: `id` (UUID PK), `channelId` (FK), `agentId` (string), `startedAt` (timestamp), `finishedAt` (timestamp), `status` (string: `'success' | 'failure' | 'timeout' | 'running'`), `durationMs` (integer), `logExcerpt` (text, nullable), `errorSummary` (text, nullable), `tokenUsage` (text, JSON string, nullable), `costCents` (integer, nullable).

2. **`reports` table** (existing, extended) — add `agentId` column (string, nullable). Existing rows get `NULL` agentId (backward compatible). New reports from multi-agent workspaces include `agentId` for per-agent attribution.

**Rationale:** `RunReport` = "what actually happened" (structured execution metadata). `ReportEnvelope` = "what the agent wants to tell you" (narrative briefings, ralph loops). Different concerns, different tables, different query patterns.

- `RunReport` type in `@harnesstune/shared`: matches `agent_runs` columns
- Summary endpoint (RLYX-04) aggregates from `agent_runs`
- Timeline/reports endpoints filter by `agentId` on the `reports` table

### D-02: Agent registration — explicit + upsert

**`agents` table** (new): `id` (UUID PK), `channelId` (FK → channels.id), `agentId` (string, unique within channel), `name` (string, nullable), `platform` (string, freeform — e.g., `'paperclip'`, `'claude-desktop'`, `'claude-code'`, `'openclaw'`), `schedule` (string, nullable — cron expression or description), `lastRunAt` (timestamp, nullable), `status` (string, default `'unknown'`), `createdAt` (timestamp).

**Unique constraint:** `(channelId, agentId)` — one agent identity per channel.

**Two creation paths:**

1. **Explicit**: `POST /channels/:id/agents` with `{ agentId, name, platform, schedule }`. Returns created agent. Used by collector `setup` (Phase 12) and manual testing.

2. **Upsert on report/run**: When `POST /channels/:id/reports` or a new `agent_runs` insert arrives with an `agentId` not in the `agents` table, auto-create a stub record with `agentId` + `platform` (from payload) + `name: null` + `schedule: null`. The collector can later `PATCH` the stub with full metadata.

**Platform field is freeform string** — no enum, no migration needed for new platforms.

### D-03: Registry v2→v3 migration — empty agents array

`WorkspaceRegistryData` version bumped to 3. Migration adds `agents: []` (empty `AgentIdentity[]`) to all existing workspaces.

- **Remote workspaces**: populate `agents[]` from relay on first poll via `GET /channels/:id/agents`. Extension-side array is a cache, refreshed each poll cycle.
- **Local workspaces** (claude-code, openclaw): stay empty. Local adapters have 1:1 workspace-to-agent relationship and don't use `agentId`. No synthetic agent entries.

```typescript
// AgentIdentity — extension-side cache of relay agent data
interface AgentIdentity {
  id: string;          // relay-assigned UUID
  agentId: string;     // platform-specific identifier
  name: string | null;
  platform: string;
  schedule: string | null;
  lastRunAt: string | null;  // ISO 8601
  status: string;
}
```

Migration pattern follows v1→v2 precedent in `WorkspaceRegistry.load()`: detect version, transform, auto-persist.

### D-04: Summary endpoint — on-the-fly aggregation

`GET /channels/:id/summary?days=N` computes aggregates at query time:

```sql
SELECT agentId,
  COUNT(*) as totalRuns,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
  SUM(costCents) as totalCostCents,
  MAX(finishedAt) as lastRunAt
FROM agent_runs
WHERE channelId = ? AND startedAt >= ?
GROUP BY agentId
```

**Performance:** Add composite index `(channelId, startedAt)` on `agent_runs`. Expected volumes (tens of agents, hundreds of runs/day) are well within SQLite's query-time aggregation capabilities.

**Response shape:**

```typescript
interface ChannelSummary {
  channelId: string;
  days: number;
  agents: AgentSummary[];
}

interface AgentSummary {
  agentId: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;  // 0-1
  totalCostCents: number;
  lastRunAt: string | null;
}
```

No pre-aggregation, no materialized views, no cache invalidation complexity.

### D-05: Relay endpoints — new and extended

**New endpoints:**
- `POST /channels/:id/agents` — register agent (body: `{ agentId, name?, platform, schedule? }`)
- `GET /channels/:id/agents` — list all agents for channel
- `GET /channels/:id/agents/:agentId/runs` — paginated run history (query: `?since=&limit=20`)
- `GET /channels/:id/summary?days=N` — aggregated summary per agent
- `POST /channels/:id/runs` — upload run report (body: `RunReport` fields)

**Extended endpoints:**
- `GET /channels/:id/reports?since=&agentId=` — add optional `agentId` filter parameter
- `POST /channels/:id/reports` — accept optional `agentId` in body for attribution

**Auth:** All endpoints use existing Bearer token middleware (token → channelId binding). No per-agent auth — channel-level token grants access to all agents within that channel.

### D-06: RunReport shared type

```typescript
// In @harnesstune/shared
interface RunReport {
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs: number;
  logExcerpt?: string;     // truncated log output
  errorSummary?: string;   // error message if failed
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  costCents?: number;
}
```

This is distinct from `ReportEnvelope` — not a report type, but a structured execution record. Uploaded via `POST /channels/:id/runs`, stored in `agent_runs` table.

## Canonical Refs

| What | Where |
|------|-------|
| WorkspaceRecord + BackendType + WorkspaceMode | `src/types/workspace.ts` |
| WorkspaceRegistry (v1→v2 migration pattern) | `src/registry/WorkspaceRegistry.ts` |
| AgentEvent + AgentIdentity types | `src/types/agent.ts` |
| ReportEnvelope + report body types | `packages/shared/src/reports.ts` |
| Relay Drizzle schema | `packages/harnesstune-relay/src/db/schema.ts` |
| Relay routes (channels/reports/messages) | `packages/harnesstune-relay/src/routes/` |
| RemoteAdapter (polling, backoff, event synthesis) | `src/adapters/RemoteAdapter.ts` |
| RelayClient (HTTP wrapper) | `src/relay/RelayClient.ts` |
| Auth middleware (token → channelId) | `packages/harnesstune-relay/src/middleware/auth.ts` |
| Rate limit middleware | `packages/harnesstune-relay/src/middleware/rateLimit.ts` |

## Code Context

- **Registry migration pattern**: `WorkspaceRegistry.load()` checks `data.version`, transforms records, auto-persists on first load. Phase 11 adds v2→v3 path.
- **Drizzle migration pattern**: Schema defined in `schema.ts`, Drizzle handles table creation. Adding `agents` and `agent_runs` tables follows existing `channels`/`tokens`/`reports`/`messages` pattern.
- **Relay route pattern**: Each route file exports a Hono router, mounted in `app.ts`. Auth middleware applied per-route. New route files: `agents.ts`, `runs.ts`, `summary.ts`.
- **RelayClient extension**: Add `getAgents()`, `getRuns(agentId, since?)`, `getSummary(days)`, `registerAgent()` methods following existing patterns (`getReports`, `getMessages`).
- **RemoteAdapter extension**: After fetching agents via `getAgents()`, update workspace registry cache. No per-agent adapter instances needed yet — that's a Phase 12+ concern when collector reports per-agent.

## Deferred Ideas

- **Per-agent tokens** — separate auth tokens per agent instead of per-channel. Adds granular access control but increases token management complexity. Not needed for v3.0 where the collector uses one channel token.
- **Agent groups / tags** — grouping agents by purpose (e.g., "scraping", "analysis"). Nice for filtering but no requirement demands it.
- **Run log streaming** — real-time log tailing via WebSocket for active runs. Out of scope; `logExcerpt` captures post-run summary.
- **Cost alerting on summary endpoint** — threshold-based alerts when cost exceeds budget. Belongs in Phase 16 (alerting).

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | MAWM-04 (reports tagged with agentId), RLYX-01 (reports filterable by agent) |
| D-02 | MAWM-02 (multiple agents per workspace), MAWM-03 (AgentIdentity type), RLYX-02 (GET agents list) |
| D-03 | MAWM-01 (workspace = platform instance), MAWM-03 (WorkspaceRecord extended) |
| D-04 | RLYX-04 (pre-aggregated summary endpoint) |
| D-05 | RLYX-01 (agentId filter), RLYX-02 (agent list), RLYX-03 (per-agent runs), RLYX-04 (summary) |
| D-06 | MAWM-04 (RunReport type in shared), RLYX-03 (run history data shape) |

## Notes

- **MAWM-05 discrepancy**: Requirements traceability matrix assigns MAWM-05 to Phase 11, but ROADMAP.md assigns it to Phase 12 (collector auto-discovery). Phase 12 is correct — MAWM-05 depends on the collector daemon which is Phase 12's deliverable. No action needed in Phase 11.
