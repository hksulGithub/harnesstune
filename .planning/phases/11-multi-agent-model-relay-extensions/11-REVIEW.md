---
phase: 11
status: issues_found
depth: standard
files_reviewed: 11
findings:
  critical: 2
  warning: 7
  info: 4
  total: 13
---

# Code Review: Phase 11 — Multi-Agent Model + Relay Extensions

## Findings

### CR-01: Content-Length bypass allows >2MB report bodies (critical)
**File:** `packages/harnesstune-relay/src/routes/reports.ts:21-28`
**Description:** The 2MB payload guard reads `Content-Length` from the request header and skips enforcement entirely if the header is absent (`parseInt('0') = 0` which is never `> MAX_REPORT_SIZE`). Clients can omit `Content-Length` and upload arbitrarily large bodies. This is exploitable by any authenticated token to exhaust relay storage or memory.
**Recommendation:** Enforce the limit on the actual parsed body size rather than (or in addition to) the header. After `c.req.json()`, check `JSON.stringify(body.body).length > MAX_REPORT_SIZE` and return 413. Alternatively, configure a global body-size limit at the Hono app or runtime level (e.g., Vercel's `bodySizeLimit` in `vercel.json`).

---

### CR-02: Route collision — runsRouter mounted at two paths, GET broken on base path (critical)
**File:** `packages/harnesstune-relay/src/app.ts:51-52` and `packages/harnesstune-relay/src/routes/runs.ts:61-63`
**Description:** `runsRouter` is mounted at both `/channels/:channelId/runs` (line 51) and `/channels/:channelId/agents/:agentId/runs` (line 52). The GET handler in `runs.ts` reads `c.req.param('agentId')` (line 63). When a request arrives via the base path `/channels/:channelId/runs`, the `agentId` param does not exist — it resolves to `undefined`. The Drizzle query then executes `eq(agentRuns.agentId, undefined)`, which may match all rows or throw, exposing run records across all agents to any authenticated channel member.
**Recommendation:** Split into two routers: one for `POST /channels/:channelId/runs` (upload-only, no GET), and one for `GET /channels/:channelId/agents/:agentId/runs`. Add an explicit guard `if (!agentId) return c.json({ error: 'agentId is required' }, 400)` in the GET handler as a safety net.

---

### WR-01: Upsert in agents POST returns stale record (warning)
**File:** `packages/harnesstune-relay/src/routes/agents.ts:25-35`
**Description:** When an agent already exists and fields are updated (`name`, `schedule`), the handler returns `existing[0]` — the pre-update snapshot fetched before the `db.update()` call. The caller receives outdated data rather than the record as it now stands.
**Recommendation:** After the `db.update()` call, re-fetch the record and return that. Or, if re-fetching is undesirable for performance, build the updated object in-memory: `return c.json({ ...existing[0], ...updates }, 200)`.

---

### WR-02: `durationMs` not validated — schema is `notNull` but value can be NaN (warning)
**File:** `packages/harnesstune-relay/src/routes/runs.ts:23-24` and `packages/harnesstune-relay/src/routes/runs.ts:34`
**Description:** `durationMs` is not included in the required-field check on line 23-24 (`!body.agentId || !body.startedAt || ...`), yet the schema column is `notNull`. If a caller omits `durationMs`, the expression `body.durationMs ?? 0` stores `0`, which may be silently wrong. More dangerously, if a caller sends `durationMs: "abc"`, the integer column receives a non-integer value without any type validation. Similarly, `startedAt` and `finishedAt` are passed directly to `new Date()` with no format check — an invalid date string produces `Invalid Date`, which serializes to `null` in SQLite and may corrupt the `agent_runs` row.
**Recommendation:** Validate that `body.durationMs` is a non-negative number, and that `new Date(body.startedAt).getTime()` and `new Date(body.finishedAt).getTime()` return valid (non-NaN) timestamps before inserting.

---

### WR-03: `reportCursor` and `messageCursor` advanced by both `poll()` and `getTimelineItems()` independently (warning)
**File:** `src/adapters/RemoteAdapter.ts:107-109` and `src/adapters/RemoteAdapter.ts:181-183`
**Description:** Both `poll()` (background loop) and `getTimelineItems()` (called explicitly by the UI panel) read and advance `this.reportCursor` and `this.messageCursor` on the same `RemoteAdapter` instance. If both run concurrently or in close succession, one call can consume events that the other was about to process, causing silent event loss in either the background event stream or the timeline UI. The cursor is a shared mutable state with no locking.
**Recommendation:** Decide on a single owner of cursor advancement. The most straightforward fix: `getTimelineItems()` should not use the instance cursors for requests — instead it should let the poll loop own those cursors and `getTimelineItems()` should fetch with its own local cursor or a snapshot. Alternatively, flag that the adapter is mid-poll and queue the timeline fetch.

---

### WR-04: `discoverChannelId` returns empty string on resolution failure (warning)
**File:** `src/relay/RelayClient.ts:138`
**Description:** `data.channelId ?? data.id ?? ''` — if both fields are absent from the response, the method returns an empty string instead of throwing. Callers that assign the result to a channel ID will silently operate with an empty string, producing malformed API paths like `/channels//reports` which will 404 or match unintended routes.
**Recommendation:** Replace the trailing fallback with a thrown error: `if (!channelId) throw new RelayError(0, 'Channel ID not found in /channels/me response');`

---

### WR-05: Missing unique constraint on `agents(channelId, agentId)` in schema (warning)
**File:** `packages/harnesstune-relay/src/db/schema.ts:34-44`
**Description:** The CONTEXT.md D-02 specifies `"Unique constraint: (channelId, agentId) — one agent identity per channel"`. The schema definition has no such unique constraint. The application-level upsert check in `agents.ts` (SELECT + conditional INSERT) is a TOCTOU race: two concurrent registrations for the same `(channelId, agentId)` pair can both pass the SELECT check and both insert, creating duplicate rows. Subsequent queries would match the first row arbitrarily, and the `lastRunAt` update in `runs.ts` would update both rows inconsistently.
**Recommendation:** Add `.unique()` on the `agentId` column scoped to `channelId`, or define a `uniqueIndex` on `(channelId, agentId)` in the Drizzle table definition. This enforces the constraint at the database level and allows replacing the SELECT+INSERT pattern with a true `INSERT OR IGNORE` / upsert.

---

### WR-06: v2→v3 migration loses `mode` field for workspaces that had it set (warning)
**File:** `src/registry/WorkspaceRegistry.ts:32-38`
**Description:** The v2→v3 migration spreads `...ws` into each record, which should preserve `mode` if it exists. However, the spread also overwrites `backendType` unconditionally with `ws.backendType ?? 'claude-code'`. More critically, `ws` in this block is typed as `WorkspaceRecord` (a v3 shape), but the data on disk is v2 — any field present in v3 but absent in v2 (specifically `agents`) is added as `[]`, which is correct. The real risk is the opposite: if a v2 record somehow has `agents` already (e.g., from a partial migration), the spread silently keeps it rather than resetting to `[]`. This is low-risk in practice but the type cast `(ws as WorkspaceRecord)` hides the actual data shape being processed. There is also no guard against an unexpected `version: 0` or negative version — the `else` branch throws a useful error for high versions but the version union type `1 | 2 | 3` would cause a TypeScript narrowing gap if a 0 or 4 appears.
**Recommendation:** Narrow the else clause's condition to `data.version > 3` explicitly, and add a `version < 1` guard. Document that `ws` in v2 migration is partially typed and consider an explicit v2 interface.

---

### WR-07: `getReports` returns `ReportEnvelope[]` but relay response contains `createdAt`, not `generatedAt` (warning)
**File:** `src/relay/RelayClient.ts:86-88` and `packages/harnesstune-relay/src/routes/reports.ts:69-80`
**Description:** The relay GET list response returns `{ id, channelId, type, agentId, createdAt }` — fields from the DB row. `ReportEnvelope` requires `{ type, body, generatedAt, reportId, agentId? }`. The client casts the response to `ReportEnvelope[]` without validation. In `RemoteAdapter.poll()` (line 107), `report.generatedAt` is read and used as the cursor — but the object actually has `createdAt`, so `report.generatedAt` is `undefined`, the cursor never advances, and every poll re-fetches all reports from the beginning (or re-fetches from the initial cursor forever). This is a functional bug causing duplicate event emission on every poll cycle.
**Recommendation:** Either (a) define a separate `ReportListItem` type matching the actual relay response shape `{ id, channelId, type, agentId?, createdAt }` and use it in `getReports()`; or (b) have the relay GET endpoint return `generatedAt` and `reportId` fields (read from the stored JSON body or added as separate columns). The cursor in `RemoteAdapter` should use the field that actually exists on the list response.

---

### IR-01: `agentRuns` table missing `createdAt` column (info)
**File:** `packages/harnesstune-relay/src/db/schema.ts:46-58`
**Description:** Every other table (`channels`, `tokens`, `reports`, `messages`, `agents`) has a `createdAt` timestamp column for audit and ordering. `agentRuns` omits it, relying on `startedAt`/`finishedAt` from the payload. If a run is uploaded late (delayed sync from an offline agent), `startedAt` will differ significantly from the insertion time. There is no way to query runs by when they were recorded rather than when they ran.
**Recommendation:** Add `createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())` to `agentRuns` for consistency and auditability.

---

### IR-02: `ReportEnvelope.reportId` is required in shared type but relay ignores it (info)
**File:** `packages/shared/src/reports.ts:37` and `packages/harnesstune-relay/src/routes/reports.ts:30`
**Description:** `ReportEnvelope` declares `reportId: string` as a required field (no `?`). The relay POST handler parses `{ type, body, agentId? }` and ignores `reportId` entirely — it generates its own `id` via `randomUUID()`. Callers are required by the type to provide a field the server discards. This creates confusion about whether the caller-supplied `reportId` or the server-assigned `id` is authoritative.
**Recommendation:** Either (a) make `reportId` optional in `ReportEnvelope` with a note that it is client-generated and not stored; or (b) have the relay store and return `reportId` alongside its own PK `id` for idempotency purposes. Ensure `generatedAt` is handled the same way.

---

### IR-03: `getSummary` injects `days` parameter directly into URL string (info)
**File:** `src/relay/RelayClient.ts:177`
**Description:** `getSummary(days = 7)` builds the URL as `` `/channels/${this.channelId}/summary?days=${days}` ``. While `days` is typed as `number`, any caller passing a string (e.g., from user input) could inject query-string content. This is low risk given TypeScript's type checking but inconsistent with the `URLSearchParams` approach used in `getReports` and `getMessages`.
**Recommendation:** Use `URLSearchParams` for consistency: `new URLSearchParams({ days: String(days) })`.

---

### IR-04: `status` field not updated on agent stub after upsert-on-run (info)
**File:** `packages/harnesstune-relay/src/routes/runs.ts:42-54`
**Description:** When a run is posted and the agent stub is created or already exists, the agent's `status` column is not updated to reflect the run outcome. After a `'failure'` run, the agent still shows `status: 'unknown'` (default) or whatever it was before. The `lastRunAt` is correctly updated, but status is not. Callers reading `GET /channels/:id/agents` will see stale status on agents that only register via the upsert-on-run path.
**Recommendation:** After inserting or confirming the stub, also update `agents.status` to match the run `body.status` (mapping `'success'` / `'failure'` etc. as appropriate to the agent's current status string).

---

## Files Reviewed

- `packages/harnesstune-relay/src/app.ts`
- `packages/harnesstune-relay/src/db/schema.ts`
- `packages/harnesstune-relay/src/routes/agents.ts`
- `packages/harnesstune-relay/src/routes/reports.ts`
- `packages/harnesstune-relay/src/routes/runs.ts`
- `packages/harnesstune-relay/src/routes/summary.ts`
- `packages/shared/src/reports.ts`
- `src/adapters/RemoteAdapter.ts`
- `src/registry/WorkspaceRegistry.ts`
- `src/relay/RelayClient.ts`
- `src/types/workspace.ts`
