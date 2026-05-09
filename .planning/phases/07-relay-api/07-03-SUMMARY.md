---
phase: 07-relay-api
plan: 03
subsystem: infra
tags: [hono, vercel, turso, libsql, serverless, deployment, drizzle]

requires:
  - phase: 07-02
    provides: relay route handlers (channels, reports, messages) wired into Hono app
provides:
  - Vercel serverless entry point wrapping Hono app via hono/vercel handle()
  - vercel.json routing all /api/* and /health to catch-all function
  - .env.example documenting all required environment variables
  - .gitignore protecting .env and build artifacts from version control
affects: [agent-cli, remote-adapter]

tech-stack:
  added: []
  patterns: [hono-vercel-catch-all, env-example-pattern, gitignore-env-protection]

key-files:
  created:
    - packages/harnesstune-relay/api/[[...route]].ts
    - packages/harnesstune-relay/vercel.json
    - packages/harnesstune-relay/.env.example
    - packages/harnesstune-relay/.gitignore
  modified: []

key-decisions:
  - "Single catch-all api/[[...route]].ts entry point routes all requests through Hono app — avoids per-route Vercel functions, simplifies deployment"
  - "vercel.json rewrites /health directly to /api catch-all — health endpoint served from same function, no separate Vercel function needed"
  - "framework: null in vercel.json — relay is not a Next.js project, Vercel must not auto-detect a framework"

patterns-established:
  - "Hono Vercel adapter: import { handle } from 'hono/vercel'; export default handle(app)"

requirements-completed: [RLAY-01, RLAY-13]

duration: 5min
completed: 2026-04-19
---

# Phase 7 Plan 03: Relay API Vercel Deployment Summary

**Vercel catch-all serverless entry point + vercel.json routing for the complete Hono relay — ready for `vercel deploy` once Turso credentials are set.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-19T08:50:00Z
- **Completed:** 2026-04-19T08:56:15Z
- **Tasks:** 1 of 2 (Task 2 is a human-verify checkpoint — paused awaiting deployment)
- **Files modified:** 4

## Accomplishments

- Created Vercel serverless entry point wrapping the complete Hono app via `hono/vercel` handle()
- Created vercel.json with rewrites routing all `/api/*` and `/health` to the catch-all function
- Created `.env.example` documenting TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and RELAY_MIN_AGENT_VERSION
- Created `.gitignore` protecting `.env`, `dist/`, and `.vercel/` from version control

## Task Commits

Each task was committed atomically:

1. **Task 1: Vercel entry point + config + env example** - `b718ac1` (feat)

Task 2 (Deploy to Vercel and verify relay is live) is a `checkpoint:human-verify` — paused awaiting user deployment.

## Files Created/Modified

- `packages/harnesstune-relay/api/[[...route]].ts` - Vercel catch-all serverless entry using hono/vercel handle()
- `packages/harnesstune-relay/vercel.json` - Routing config: rewrites /api/* and /health to catch-all, framework null
- `packages/harnesstune-relay/.env.example` - Documents TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, RELAY_MIN_AGENT_VERSION
- `packages/harnesstune-relay/.gitignore` - Protects .env, node_modules, dist, .vercel

## Decisions Made

- Used `hono/vercel` handle() adapter — standard Hono Vercel integration, wraps fetch-based Hono app into Vercel's serverless function format
- `framework: null` in vercel.json — prevents Vercel from auto-detecting Next.js or other frameworks
- `installCommand: pnpm install` and `buildCommand: pnpm run build` specified explicitly to match monorepo tooling

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Worktree was based on an outdated commit (Phase 5 HEAD). Reset to the correct base `055fe922` (Phase 07 wave 2 tracking commit) before executing. This is a worktree initialization issue, not a code issue.

## User Setup Required

External services require manual configuration before Task 2 can proceed:

**Turso database:**
1. `curl -sSfL https://get.tur.so | bash` — install Turso CLI
2. `turso db create harnesstune-relay` — create database
3. `turso db show harnesstune-relay --url` — copy database URL
4. `turso db tokens create harnesstune-relay` — copy auth token
5. Create `packages/harnesstune-relay/.env` with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
6. `cd packages/harnesstune-relay && npx drizzle-kit push` — push schema (creates 5 tables)

**Vercel deployment:**
1. `cd packages/harnesstune-relay && vercel deploy`
2. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel Dashboard -> Settings -> Environment Variables
3. Redeploy: `vercel deploy`

**Verification:**
- `curl https://YOUR-DEPLOYMENT.vercel.app/health` → `{"status":"ok","version":"0.1.0"}`

## Next Phase Readiness

- Task 1 complete: all deployment config files in place
- Relay is code-complete (Plans 01-02 built foundation + routes; Plan 03 Task 1 adds Vercel entry point)
- Pending: Task 2 human-verify checkpoint (Turso setup, schema push, Vercel deploy, endpoint verification)
- After Task 2 approval: relay is live and ready for Agent CLI (Phase 08) integration

---
*Phase: 07-relay-api*
*Completed: 2026-04-19 (partial — Task 2 checkpoint pending)*
