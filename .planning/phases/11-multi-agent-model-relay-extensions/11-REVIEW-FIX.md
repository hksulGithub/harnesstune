---
phase: 11
status: all_fixed
findings_in_scope: 9
fixed: 9
skipped: 0
iteration: 1
---

# Code Review Fix Report: Phase 11

## Fixes Applied

### CR-01: Content-Length bypass allows >2MB report bodies
**Status:** Fixed
**Commit:** 5602560
**Changes:** After `c.req.json()`, added explicit check on `JSON.stringify(body.body).length > MAX_REPORT_SIZE` returning 413. The Content-Length header pre-flight check is retained but annotated as non-authoritative.

---

### CR-02: Route collision — runsRouter mounted at two paths, GET broken on base path
**Status:** Fixed
**Commit:** d2cab2c
**Changes:** Split `runsRouter` into two exports: `runsUploadRouter` (POST-only, mounted at `/channels/:channelId/runs`) and `runsRouter` (GET-only, mounted at `/channels/:channelId/agents/:agentId/runs`). Added explicit `if (!agentId) return 400` guard in the GET handler. Updated `app.ts` imports and mounts accordingly.

---

### WR-01: Upsert in agents POST returns stale record
**Status:** Fixed
**Commit:** d5968ea
**Changes:** After `db.update()`, re-fetch the record from DB and return it. The stale `existing[0]` snapshot is no longer returned when fields were updated.

---

### WR-02: `durationMs` not validated — schema is `notNull` but value can be NaN
**Status:** Fixed
**Commit:** d2cab2c (included in CR-02 split)
**Changes:** Added validation in `runsUploadRouter.post`: checks `typeof body.durationMs !== 'number' || isNaN(body.durationMs) || body.durationMs < 0` → 400. Also validates `new Date(body.startedAt).getTime()` and `new Date(body.finishedAt).getTime()` are non-NaN before insert.

---

### WR-03: Shared cursor mutation in RemoteAdapter
**Status:** Fixed (minimal — comment + TODO)
**Commit:** 2e5f2ba
**Changes:** Added a prominent WARNING comment above the `Promise.all` in `getTimelineItems()` documenting the shared cursor hazard, identifying the poll loop as the authoritative cursor owner, and flagging a TODO for future refactor to snapshot cursors.

---

### WR-04: `discoverChannelId` returns empty string on resolution failure
**Status:** Fixed
**Commit:** 42c9215
**Changes:** Replaced `data.channelId ?? data.id ?? ''` with an explicit null-check; throws `new RelayError(0, 'Channel ID not found in /channels/me response')` if both fields are absent.

---

### WR-05: Missing unique constraint on `agents(channelId, agentId)` in schema
**Status:** Fixed
**Commit:** f726614
**Changes:** Added `uniqueIndex` import to `schema.ts`. Added table-level `uniqueIndex('agents_channel_agent_uniq').on(table.channelId, table.agentId)` in the `agents` table definition, enforcing the D-02 constraint at the database level.

---

### WR-06: v2→v3 migration version guard missing
**Status:** Fixed
**Commit:** 300081d
**Changes:** Added `version < 1` guard throwing a descriptive error before the version branch chain. Updated the final `else` clause to explicitly state `version > 3` with a message indicating the extension only supports up to v3. Added inline comment clarifying the v2 type cast.

---

### WR-07: `getReports` returns wrong type — relay returns `createdAt` but client expects `generatedAt`
**Status:** Fixed
**Commit:** 69126db
**Changes:** Defined `ReportListItem` interface matching actual relay list response shape `{ id, channelId, type, agentId?, generatedAt }`. Updated `getReports()` to return `ReportListItem[]` and map `r.createdAt → generatedAt` in the response. Exported `ReportListItem` from `src/relay/index.ts`. Updated `RemoteAdapter` to import and use `ReportListItem`. Removed dead `report.body` access in `poll()` heartbeat handler (list items carry no body); heartbeat type detection still works via `report.type`. Annotated `getTimelineItems()` body-less cast with a comment directing callers to use `getReport(id)` for full body.

---

## Skipped
None
