---
phase: 08-agent-cli-daily-briefing-reports
plan: 02
subsystem: api
tags: [typescript, esm, node, cli, readline, sigterm, pid, fetch, crypto]

# Dependency graph
requires:
  - phase: 08-01
    provides: config.ts (readConfig/writeConfig/readPid/removePid), client.ts (createClient), index.ts (AGENT_VERSION)
provides:
  - CLI entry point cli.ts with shebang + argv dispatch for register/start/stop/report subcommands
  - register command with readline/promises interactive prompts and --relay-url/--name flag overrides
  - stop command with SIGTERM via PID file and stale PID cleanup on ESRCH
  - report command reading from file path or stdin, adding generatedAt + reportId envelope, with --dry-run support
  - start command stub (exits 1, implemented in Plan 03)
affects:
  - 08-03 (sidecar loop — replaces start.ts stub with full implementation)
  - extension RemoteAdapter (CLI commands are the agent-side counterpart)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "shebang preserved by tsc — #!/usr/bin/env node as first line of cli.ts passes through to dist/cli.js"
    - "Zero-dependency argv parsing: rawArgs.includes('--dry-run') + filter pattern for flag stripping"
    - "readline/promises createInterface for interactive terminal prompts (no external dep)"
    - "ESRCH error code check for stale PID detection: err instanceof Error && 'code' in err pattern"
    - "randomUUID from node:crypto for reportId envelope field (no external dep)"
    - "for await loop over process.stdin for streaming stdin read"

key-files:
  created:
    - packages/harnesstune-agent/src/cli.ts
    - packages/harnesstune-agent/src/commands/register.ts
    - packages/harnesstune-agent/src/commands/start.ts
    - packages/harnesstune-agent/src/commands/stop.ts
    - packages/harnesstune-agent/src/commands/report.ts
  modified: []

key-decisions:
  - "cli.ts strips --dry-run before subcommand dispatch, threads dryRun boolean into start/report opts"
  - "register.ts uses plain fetch (not RelayClient) because no token exists at registration time"
  - "stop.ts uses synchronous process.kill() + inline ESRCH check (not dynamic import) for simplicity"
  - "report.ts adds generatedAt + reportId envelope metadata before upload per BRFG-03 requirement"
  - "start.ts is a stub exiting 1 — deferred to Plan 03 per plan specification"

patterns-established:
  - "commands/ directory pattern: one file per subcommand, each exports a single async function matching subcommand name"
  - "Flag parsing: parseFlags(args) helper returns Record<string, string>, consumed by command functions"
  - "Dry-run guard: opts?.dryRun check before any network call, prints validation summary instead"

requirements-completed: [ACLI-01, ACLI-02, ACLI-03, ACLI-08, ACLI-10]

# Metrics
duration: 1min
completed: 2026-04-19
---

# Phase 08 Plan 02: CLI Entry Point + Register/Stop/Report Commands Summary

**Subcommand CLI dispatcher (cli.ts) with register (readline interactive + POST /api/channels), stop (SIGTERM via PID file), and report (file/stdin JSON upload with generatedAt+reportId envelope) commands**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-19T14:27:44Z
- **Completed:** 2026-04-19T14:29:29Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- cli.ts dispatches all four subcommands with shebang preserved through TypeScript compilation to dist/cli.js
- register.ts handles both interactive (readline/promises) and scriptable (--relay-url/--name flags) registration flows against POST /api/channels
- stop.ts sends SIGTERM to running sidecar via PID file with ESRCH-based stale PID cleanup
- report.ts reads JSON from file path or stdin, adds generatedAt (ISO 8601) + reportId (UUID) envelope fields, uploads to relay or validates with --dry-run

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CLI entry point and register command** - `554d047` (feat)
2. **Task 2: Create stop and report commands** - `34f34a2` (feat)

## Files Created/Modified

- `packages/harnesstune-agent/src/cli.ts` — Shebang entry point, argv dispatch, --dry-run flag stripping
- `packages/harnesstune-agent/src/commands/register.ts` — readline/promises interactive prompts, POST /api/channels, writeConfig
- `packages/harnesstune-agent/src/commands/start.ts` — Stub exiting 1 (Plan 03 implementation)
- `packages/harnesstune-agent/src/commands/stop.ts` — readPid, process.kill SIGTERM, ESRCH stale PID cleanup
- `packages/harnesstune-agent/src/commands/report.ts` — File/stdin read, JSON validation, envelope metadata, createClient upload, dry-run mode

## Decisions Made

- `cli.ts` strips `--dry-run` at the top level before subcommand dispatch and threads `dryRun: boolean` into `start` and `report` opts — keeps subcommand signatures consistent without each command needing to re-parse flags
- `register.ts` uses plain `fetch` instead of `RelayClient` because `createClient` requires a token that doesn't exist yet at registration time
- `stop.ts` inline ESRCH check uses `err instanceof Error && 'code' in err` pattern instead of a cast to `any` — type-safe error code access
- `report.ts` adds `generatedAt` and `reportId` in the upload envelope (not just validation) — fulfills BRFG-03 traceability requirement regardless of whether the original JSON included these fields

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 03 (sidecar loop) can replace the `start.ts` stub with full foreground daemon logic — stub is import-compatible
- All four subcommands build and dispatch correctly; `node dist/cli.js` with no args prints usage and exits 1
- `harnesstune-agent register` and `harnesstune-agent report <file>` are fully usable against a live relay

---

## Self-Check: PASSED

- `packages/harnesstune-agent/src/cli.ts` — EXISTS
- `packages/harnesstune-agent/src/commands/register.ts` — EXISTS
- `packages/harnesstune-agent/src/commands/start.ts` — EXISTS
- `packages/harnesstune-agent/src/commands/stop.ts` — EXISTS
- `packages/harnesstune-agent/src/commands/report.ts` — EXISTS
- `packages/harnesstune-agent/dist/cli.js` — EXISTS with shebang
- Build: PASS (tsc --build exits 0)
- `node dist/cli.js` (no args): prints usage, exits 1
- Commit `554d047` — Task 1
- Commit `34f34a2` — Task 2

---
*Phase: 08-agent-cli-daily-briefing-reports*
*Completed: 2026-04-19*
