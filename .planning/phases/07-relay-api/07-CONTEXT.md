# Phase 07 Context: Relay API

Created: 2026-04-19
Phase: 07 — Relay API
Status: Decisions locked

## Prior Decisions (from Phase 06)

- **D-01** (pnpm workspaces): Relay lives at `packages/harnesstune-relay`, already scaffolded
- **D-02** (packages/shared): Shared types imported from `@harnesstune/shared`
- **D-04** (exhaustive switches): `assertNeverBackendType` pattern for exhaustive route/type handling

## Decisions

### D-01: Single Catch-All Hono App

**Decision:** One `api/[[...route]].ts` Vercel entry point exporting a Hono app. All routes defined in `src/app.ts` with `.route()` groups. No file-based Vercel routing.

**Structure:**
```
packages/harnesstune-relay/
├── src/
│   ├── app.ts          # Hono app + all routes
│   ├── middleware/
│   │   ├── auth.ts     # token verify (SHA-256 + timingSafeEqual)
│   │   ├── rateLimit.ts
│   │   ├── sanitize.ts # header redaction
│   │   └── version.ts  # X-Agent-Version check
│   ├── db/
│   │   ├── client.ts   # Turso/Drizzle init (module-scope)
│   │   └── schema.ts   # Drizzle table definitions
│   └── index.ts        # re-exports
├── api/
│   └── [[...route]].ts # Vercel catch-all entry
├── drizzle.config.ts
└── package.json
```

**Middleware chain order:**
1. Health check (`/health` — public, before auth)
2. Header sanitization (redact Authorization from logs)
3. Token auth (SHA-256 hash lookup + `crypto.timingSafeEqual`)
4. Version validation (`X-Agent-Version` header)
5. Rate limiting (per-token, after auth resolves token identity)
6. Route handlers

**Why:** ~7 endpoints is too small for file-based routing overhead. Single Hono app gives full middleware control, type safety, and one cold-start target.

### D-02: Turso Client + Drizzle Schema Management

**Decision:** Module-scope Turso client creation (`createClient` from `@libsql/client`), wrapped with Drizzle. Reused across warm Vercel invocations, re-created on cold starts. No connection pooling needed — libsql uses HTTP transport.

**Schema management:** `drizzle-kit push` during development for fast iteration. `drizzle-kit generate` to produce migration files before production deploy. Migration files committed to git.

**Messages: hard delete.** `DELETE /messages/:id` removes the row entirely. Matches the mailbox pickup metaphor — agent retrieves message, message is gone.

**Why:** Module-scope is the standard serverless pattern for libsql. Push-then-migrate balances dev speed with production safety. Hard delete is simpler and matches RLAY-09 semantics.

### D-03: Turso-Backed Rate Limiting

**Decision:** `rate_limits` table in Turso for per-token rate limiting (RLAY-14: 60 req/min). Fixed-window (per-minute) with upsert pattern.

**Schema:**
```sql
CREATE TABLE rate_limits (
  token_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,  -- unix epoch minute
  count INTEGER DEFAULT 1,
  PRIMARY KEY (token_id, window_start)
);
```

**Middleware logic:** Upsert on each authenticated request. If count > 60, return 429 Too Many Requests. Old windows can be cleaned up periodically or left to accumulate (tiny rows).

**Why:** Uses existing Turso infra — no new service dependency (Vercel KV/Redis). Adds ~1 DB round-trip per request, acceptable for a relay with moderate traffic. In-memory counters would leak across serverless instances.

## Canonical Refs

| What | Where |
|------|-------|
| Relay package scaffold | `packages/harnesstune-relay/` |
| Shared types | `packages/shared/src/` |
| Workspace types (BackendType, WorkspaceMode) | `packages/shared/src/types/workspace.ts` |
| pnpm workspace config | `pnpm-workspace.yaml` |
| Root tsconfig (project references) | `tsconfig.json` |
| Relay tsconfig | `packages/harnesstune-relay/tsconfig.json` |

## Deferred Ideas

- Soft-delete / audit trail for messages (not needed for v2.0 mailbox semantics)
- Vercel KV for rate limiting (revisit if Turso round-trip becomes a bottleneck)
- File-based Vercel routing (revisit only if function count grows significantly)
- WebSocket / real-time push (out of scope per PROJECT.md)
