---
phase: 07-relay-api
plan: 02
subsystem: relay
tags: [hono, drizzle, turso, rest-api, channel-isolation, pagination, hard-delete]
dependency_graph:
  requires: [07-01]
  provides: [relay-channel-registration, relay-report-endpoints, relay-message-endpoints]
  affects: [07-03]
tech_stack:
  added: []
  patterns: [token-once-registration, content-length-guard, since-cursor-pagination, hard-delete-acknowledge, channel-isolation-per-handler]
key_files:
  created:
    - packages/harnesstune-relay/src/routes/channels.ts
    - packages/harnesstune-relay/src/routes/reports.ts
    - packages/harnesstune-relay/src/routes/messages.ts
  modified:
    - packages/harnesstune-relay/src/app.ts
decisions:
  - "publicChannelsRouter mounted directly on app (not api) so POST /api/channels bypasses auth middleware — registration cannot require a token the agent doesn't have yet"
  - "Drizzle query builder used inline in each handler rather than a repository layer — relay is intentionally a dumb mailbox, no business logic to encapsulate"
  - "Hard delete on messages matches D-02 decision: relay stores no long-term message history, acknowledge-and-remove is the full lifecycle"
metrics:
  duration_seconds: 170
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 7 Plan 02: Relay API Route Handlers Summary

**One-liner:** 8 REST endpoints (channel registration, report upload/list/fetch, message post/poll/delete) with channel isolation enforced per-handler, all wired into the Hono app and compiling clean.

## What Was Built

All CRUD route handlers for the relay API, mounted on the Hono app from Plan 01.

### Channel Routes (`src/routes/channels.ts`)

Two routers with different auth requirements:

- **`publicChannelsRouter`** (no auth) — `POST /api/channels`: generates channelId + tokenId + rawToken, stores SHA-256 hash of token, returns raw token exactly once with 201. Name validated 1–100 chars.
- **`channelsRouter`** (authenticated) — `GET /api/channels/:channelId`: returns channel metadata. Verifies `c.get('channelId') === channelId` param to prevent cross-channel access (403 otherwise).

### Report Routes (`src/routes/reports.ts`)

Three endpoints mounted at `/api/channels/:channelId/reports`:

- **POST `/`** — upload report. Checks `Content-Length` header against 2MB limit (returns 413 with `maxBytes` + human message). Validates `type` and `body` fields. Stores body as JSON string.
- **GET `/`** — paginated metadata list. `?since=` ISO 8601 cursor via `gt(reports.createdAt, new Date(since))`. `?limit=` capped at 100. Body field intentionally excluded from select (RLAY-10).
- **GET `/:reportId`** — full body fetch. Queries with both `id` and `channelId` predicate to enforce channel isolation. Returns `body` parsed back from JSON string.

### Message Routes (`src/routes/messages.ts`)

Three endpoints mounted at `/api/channels/:channelId/messages`:

- **POST `/`** — post message. Validates `direction` enum (`to_agent` | `from_agent`), returns 400 on invalid value. Stores body as JSON string.
- **GET `/`** — poll messages with `?since=` cursor and `?limit=` (default 50, max 100). Returns all fields with body parsed back to object.
- **DELETE `/:messageId`** — hard delete scoped by both messageId and channelId. Returns `{ deleted: true, id }`.

### App Wiring (`src/app.ts`)

Final route mount order:
```
app.get('/health', ...)                                     // public
app.route('/api/channels', publicChannelsRouter)            // public (registration)
api.use('*', sanitize → auth → version → rateLimit)        // middleware chain
api.route('/channels', channelsRouter)                      // authenticated
api.route('/channels/:channelId/reports', reportsRouter)    // authenticated
api.route('/channels/:channelId/messages', messagesRouter)  // authenticated
app.route('/api', api)                                      // mount under /api
```

## Deviations from Plan

None — plan executed exactly as written. The plan's NOTE about Hono sub-router param propagation was not an issue; `c.req.param('channelId')` worked correctly in sub-routers.

## Self-Check: PASSED

**Files exist:**
- FOUND: packages/harnesstune-relay/src/routes/channels.ts
- FOUND: packages/harnesstune-relay/src/routes/reports.ts
- FOUND: packages/harnesstune-relay/src/routes/messages.ts
- FOUND: packages/harnesstune-relay/src/app.ts

**Commits exist:**
- FOUND: acee3d3 feat(07-02): channel registration + report endpoints
- FOUND: db513ae feat(07-02): message endpoints + complete app wiring

**TypeScript:** `npx tsc --noEmit` exits 0
