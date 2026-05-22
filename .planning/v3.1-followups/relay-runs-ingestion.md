---
ticket: v3.1-relay-runs-ingestion
priority: high
origin: phase-14-uat-test-2 (2026-05-09)
blocks: end-to-end RunReport visibility for claude-desktop and claude-code adapters
status: complete
closed: 2026-05-09T04:55:00.000Z
---

## Resolution (2026-05-09)

Both bugs fixed and re-verified.

- **Bug 1 fix.** `packages/harnesstune-relay/src/routes/reports.ts:57-125` now iterates `body.runs[]` on `run_batch` envelopes, validates each run, and inserts into `agent_runs` with `.onConflictDoNothing()` keyed on the new `agent_runs_channel_agent_started_uniq` unique index (`schema.ts:61-64`). Agent stub upsert + per-batch `agents.lastRunAt` update included. Approach: option A from "Fix options" — preserves envelope audit trail, lowest blast radius. `pnpm db:push` applied schema; both packages build clean.
- **Bug 2 fix.** `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts:54,69` changed `<` → `<=` (sessions with `lastActivityAt === sinceMs` now excluded). Cursor persistence added: new module `packages/harnesstune-collector/src/daemon/cursors.ts` (load/save round-trip via `~/.harnesstune/cursors.json` as ISO strings). `commands/start.ts:54-55,119` loads on startup, saves after every `runCycle`. Per-session dedup via cursor + boundary fix; no separate session-tuple set needed.
- **Verification (2026-05-09T04:34–04:52).** Relay restarted PID 57264, collector PID 57429 with rebuilt code. `GET /api/channels/24e8286d-…/agents/test-1/runs` returned `count: 1` with run `4f0fe73c-0f51-4bc8-ad5c-8bdc03d1c090`, `status="success"`, `durationMs=16775`, matching expected `startedAt`/`finishedAt`. After 17 min (≥17 poll cycles) `count` remained 1 — Bug 2 dedup verified. `cursors.json` persisted `{"claude-desktop": "2026-05-09T02:33:41.461Z"}` matching session `lastActivityAt`.
- **Phase 14 UAT.** Test 2 flipped FAILED → PASSED. Tests 4/6 Bug 1 caveats resolved.
- **Out of scope (deferred).** Ad-hoc-chat negative case for Test 2 remains code-verified only (no live trigger).

# Relay Runs Ingestion + Collector Cursor Advance

## Why

Phase 14 Test 2 confirmed the claude-desktop adapter correctly maps a triggered scheduled-task session into a valid `RunReport` and the collector daemon successfully POSTs `run_batch` envelopes to the relay. But runs never appear in `GET /api/channels/{channelId}/agents/{agentId}/runs`. Two integration bugs sit between the working adapter and the queryable runs table.

Both bugs also block Phase 14 Tests 4–6 (cron adapter end-to-end) and any Phase 16 Fleet dashboard work that reads from `/agents/:agentId/runs`.

## Bug 1 — Relay `/reports` POST never writes to `agent_runs`

**Where:** `packages/harnesstune-relay/src/routes/reports.ts:13-58`

**What happens:**
1. Collector posts `{ type: "run_batch", body: { runs: [...] }, generatedAt, reportId }` to `POST /api/channels/{channelId}/reports`.
2. Handler stores the entire envelope as a JSON blob in the `reports` table.
3. Line 45: `const agentId = (body as { agentId?: string }).agentId ?? null;` — looks for a top-level `agentId` field that does not exist on `run_batch` envelopes (the agentId lives inside `body.runs[0].agentId`).
4. Result: a `reports` row is written with `agentId: null`. Nothing is ever inserted into the `agent_runs` table.

**Where the GET reads from:** `packages/harnesstune-relay/src/routes/runs.ts:80-104` (mounted at `/channels/:channelId/agents/:agentId/runs`) queries the `agent_runs` table only. There is no path from the `run_batch` envelope to that table.

**Architectural ambiguity:** there is also a separate `POST /channels/:channelId/runs` endpoint (`runs.ts:15-76`) that *does* write to `agent_runs`. The collector points at `/reports` instead. Either the collector should switch endpoints, or the `/reports` handler should fan out `run_batch` envelopes into `agent_runs` rows.

**Fix options:**
- **A.** In `routes/reports.ts`, after envelope is persisted, if `body.type === 'run_batch'` iterate `body.runs[]` and insert into `agent_runs` (one row per run). Keep the envelope blob for audit. Simple, preserves existing collector contract.
- **B.** Change the collector (`scheduler.ts:64-99`) to post each run to `/channels/:channelId/runs` directly and drop the envelope wrapper. Cleaner separation, but breaks the batched-upload pattern and the `reports` audit trail.
- **C.** Hybrid — keep envelope POST to `/reports` for batching/audit, but have the relay handler also write per-run rows. Same effect as A.

Recommend **A**. Lowest blast radius, preserves both surfaces.

## Bug 2 — Collector re-uploads the same session every poll cycle

**Where:**
- `packages/harnesstune-collector/src/daemon/scheduler.ts:93-99` — cursor advance only fires when `runs.length > 0`.
- `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts:54,69` — boundary filters use strict `<`.

**What happens:**
1. Cycle 1: `scanSessions(dir, since=0)` returns the test-1 session (lastActivityAt = 1778294021461). Run is uploaded. Cursor advances to `cycleStart` (the timestamp at the *top* of cycle 1).
2. Cycle 2: `since = cycleStart` from cycle 1. The session's `lastActivityAt = 1778294021461` is still `< sinceMs` if cycle 1 started before 02:33:41.461 — but in this case cycle 1 started after the session finished, so `lastActivityAt < sinceMs` and the session should be excluded. **However:** the staleness guard at `reader.ts` only excludes sessions with `lastActivityAt > now - STALENESS_GUARD_MS` (i.e., too recent), not sessions that already shipped. There is no per-session "already uploaded" memory.
3. Confirmed empirically: 4 consecutive `run_batch` rows for the *same* session at 02:34:48, 02:35:51, 02:36:53, 02:37:54.

**Root cause:** the cursor is the only dedup mechanism, and the cursor only advances when runs are emitted — but emitting runs does not mean the cursor surpasses those runs' `lastActivityAt`. If the cursor is set to "wall clock at cycle start" and a session's `lastActivityAt` is *before* that cursor, the session should be excluded. But the boundary check uses `<` and the cursor advances to `cycleStart` which is always *after* `lastActivityAt` for completed sessions — so this should work. Need to re-read the actual cursor advance code path; the empirical re-upload behavior contradicts the read of the source. Possible the cursor isn't being persisted between cycles, or `since` is being reset to 0 each cycle.

**Investigation needed before fix:**
- Log `since` at the top of each cycle in `scheduler.ts` to confirm whether it's advancing.
- Check whether the cursor is in-memory only (lost across daemon restarts) vs. persisted to `~/.harnesstune/cursor.json` or similar.
- Confirm `cycleStart` timestamp vs. session `lastActivityAt` ordering.

**Likely fix:** add per-session dedup (e.g., a set of uploaded `(sessionId, lastActivityAt)` tuples persisted to disk, capped to last N entries), independent of the time cursor.

## Out of scope

- Setup wizard, plugin enablement, agent identity ingestion — all working as of Phase 14 Test 1.
- Phase 13 Paperclip shape rewrite — separate v3.1 ticket (`paperclip-shape-rewrite.md`).

## Verification plan after fix

1. Re-run Phase 14 Test 2: trigger `test-1` via Claude Desktop, wait one poll cycle, confirm `GET /channels/{cid}/agents/test-1/runs` returns the run with `status: "success"`, `durationMs ≈ 16775`, matching `startedAt`/`finishedAt`.
2. Wait two more poll cycles without triggering anything new. Confirm the runs count stays at 1 (no re-upload).
3. Trigger an ad-hoc Claude Desktop chat (no scheduledTaskId). Confirm no new run row.
4. Re-open Phase 14 Test 2 in `14-HUMAN-UAT.md`, mark PASSED.

## Notes

- Adapter behavior (the unit being UATed in Phase 14) is correct. Phase 14 Tests 3–6 are not blocked by Bug 1 (they don't exercise the runs-ingestion path) and can proceed now.
- Phase 16 Fleet dashboard UI work that lists per-agent run history *is* blocked until Bug 1 is fixed.
