---
phase: 07-relay-api
plan: 01
subsystem: relay
tags: [hono, drizzle, turso, libsql, auth, middleware, rate-limiting, security]
dependency_graph:
  requires: [06-02]
  provides: [relay-schema, relay-db-client, relay-middleware, relay-health]
  affects: [07-02, 07-03]
tech_stack:
  added: [hono@^4, @libsql/client@^0.14, drizzle-orm@^0.36, drizzle-kit@^0.30]
  patterns: [fixed-window-rate-limiting, timing-safe-token-comparison, middleware-chain, lazy-singleton-db-client]
key_files:
  created:
    - packages/harnesstune-relay/drizzle.config.ts
    - packages/harnesstune-relay/src/db/schema.ts
    - packages/harnesstune-relay/src/db/client.ts
    - packages/harnesstune-relay/src/middleware/sanitize.ts
    - packages/harnesstune-relay/src/middleware/auth.ts
    - packages/harnesstune-relay/src/middleware/version.ts
    - packages/harnesstune-relay/src/middleware/rateLimit.ts
    - packages/harnesstune-relay/src/app.ts
  modified:
    - packages/harnesstune-relay/package.json
    - packages/harnesstune-relay/tsconfig.json
    - packages/harnesstune-relay/src/index.ts
    - pnpm-lock.yaml
decisions:
  - "RELAY_VERSION defined in app.ts (not index.ts) to avoid circular import — app.ts imports from middleware, index.ts re-exports from app.ts"
  - "db export named _db alias added to client.ts alongside getDb() to satisfy plan artifact spec"
  - "sanitizeMiddleware patches console.log/warn/error per-request using try/finally to guarantee restoration"
metrics:
  duration_seconds: 144
  completed_date: "2026-04-19"
  tasks_completed: 2
  files_created: 8
  files_modified: 4
---

# Phase 7 Plan 01: Relay API Foundation Summary

**One-liner:** Hono app with Turso/Drizzle backend, 4-layer middleware chain (sanitize → auth/SHA-256+timingSafeEqual → version → rate-limit), and public `/health` endpoint on `@harnesstune/relay`.

## What Was Built

The infrastructure layer for the relay API: database schema, Turso client factory, and a complete Hono application with all security middleware wired in correct order.

### Drizzle Schema (`src/db/schema.ts`)

Five SQLite tables via Drizzle ORM:
- `channels` — UUID PK, name, createdAt
- `tokens` — UUID PK, channelId FK, tokenHash (SHA-256 hex), label, createdAt
- `reports` — UUID PK, channelId FK, type, body (JSON string), createdAt
- `messages` — UUID PK, channelId FK, direction, body (JSON string), createdAt
- `rate_limits` — composite PK (tokenId, windowStart), count

### Turso Client (`src/db/client.ts`)

Lazy singleton `getDb()` factory using `@libsql/client` + `drizzle-orm/libsql`. Reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from environment. Connection created on first call and reused.

### Middleware Chain

Order enforced in `src/app.ts` for all `/api/*` routes:

1. **sanitize** (`src/middleware/sanitize.ts`) — patches `console.log/warn/error` per-request to replace `Bearer <token>` with `Bearer [REDACTED]`. Restored via `try/finally`.
2. **auth** (`src/middleware/auth.ts`) — extracts Bearer token, SHA-256 hashes it, queries `tokens` table, performs `timingSafeEqual` on 32-byte hex buffers. Sets `tokenId` and `channelId` context variables.
3. **version** (`src/middleware/version.ts`) — checks `X-Agent-Version` header against `MIN_AGENT_VERSION = '0.1.0'`. Returns 426 Upgrade Required for outdated agents.
4. **rateLimit** (`src/middleware/rateLimit.ts`) — fixed-window 60 req/min per tokenId. Upserts `rate_limits` row, reads back count, returns 429 with `Retry-After` header when exceeded.

### Hono App (`src/app.ts`)

- Public `GET /health` → `{ status: 'ok', version: '0.1.0' }` (outside all middleware)
- `/api` subrouter with full middleware chain
- Route handlers to be added in Plan 02

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Circular import avoided by moving RELAY_VERSION to app.ts**
- **Found during:** Task 2
- **Issue:** Plan specified `app.ts` importing `RELAY_VERSION` from `./index.js` while `index.ts` imports from `./app.js` — circular dependency.
- **Fix:** Defined `RELAY_VERSION = '0.1.0'` directly in `app.ts`. `index.ts` re-exports it from `app.ts`.
- **Files modified:** `src/app.ts`, `src/index.ts`
- **Commit:** a49af05

**2. [Rule 3 - Blocking] Built shared package before relay tsc check**
- **Found during:** Task 1 verification
- **Issue:** `@harnesstune/shared` dist not present in worktree; tsc exited with TS2307.
- **Fix:** Ran `tsc --build` in `packages/shared` before relay tsc verification.
- **Impact:** No files changed; build artifact only.

## Self-Check: PASSED

**Files exist:**
- FOUND: packages/harnesstune-relay/drizzle.config.ts
- FOUND: packages/harnesstune-relay/src/db/schema.ts
- FOUND: packages/harnesstune-relay/src/db/client.ts
- FOUND: packages/harnesstune-relay/src/middleware/sanitize.ts
- FOUND: packages/harnesstune-relay/src/middleware/auth.ts
- FOUND: packages/harnesstune-relay/src/middleware/version.ts
- FOUND: packages/harnesstune-relay/src/middleware/rateLimit.ts
- FOUND: packages/harnesstune-relay/src/app.ts
- FOUND: packages/harnesstune-relay/src/index.ts

**Commits exist:**
- FOUND: 4f532ad feat(07-01): Drizzle schema + Turso client + package dependencies
- FOUND: a49af05 feat(07-01): Hono app + middleware chain + health endpoint
