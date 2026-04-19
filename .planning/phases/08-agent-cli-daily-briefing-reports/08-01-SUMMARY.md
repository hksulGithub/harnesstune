---
phase: 08-agent-cli-daily-briefing-reports
plan: 01
subsystem: api
tags: [typescript, esm, node, fetch, config, shared-types]

# Dependency graph
requires:
  - phase: 06-monorepo-relay-foundation
    provides: pnpm workspaces, @harnesstune/shared package, TypeScript project references
provides:
  - ReportType, BriefingReportBody, RalphReportBody, HeartbeatReportBody, ReportEnvelope types in @harnesstune/shared
  - AgentConfig interface with readConfig/writeConfig functions in harnesstune-agent/src/config.ts
  - PID file management (writePid, readPid, removePid) in config.ts
  - RelayClient interface and createClient factory (Bearer token + X-Agent-Version headers) in client.ts
  - package.json updated with typecheck/dev scripts, engines >= 20, files: [dist]
affects:
  - 08-02 (CLI commands — register, start, stop, report — all import from config.ts and client.ts)
  - 08-03 (sidecar loop imports config, client, and shared types)
  - extension RemoteAdapter (will import report types from @harnesstune/shared)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM imports with .js extension even for .ts source files (moduleResolution: bundler)"
    - "AGENT_VERSION imported from index.ts into client.ts for X-Agent-Version header"
    - "Per-project .harnesstune/ directory relative to process.cwd() for config isolation"
    - "rmSync used synchronously in removePid (not async import) for simplicity"

key-files:
  created:
    - packages/shared/src/reports.ts
    - packages/harnesstune-agent/src/config.ts
    - packages/harnesstune-agent/src/client.ts
  modified:
    - packages/shared/src/index.ts
    - packages/harnesstune-agent/package.json

key-decisions:
  - "ReportEnvelope includes generatedAt (ISO 8601) and reportId (UUID) fields for traceability per D-06/D-07"
  - "removePid uses synchronous rmSync (not async dynamic import) — simpler, correct for shutdown path"
  - "X-Agent-Version header sourced from AGENT_VERSION in index.ts — relay versionMiddleware checks this"
  - "engines: node >=20 in package.json — fails fast on npx with Node < 20"
  - "files: [dist] in package.json — excludes src/ from npm publish, minimal published size"

patterns-established:
  - "reports.ts: interface-only file, no runtime deps, matches src/types/agent.ts pattern"
  - "config.ts: synchronous fs reads/writes, throws with actionable error on missing config"
  - "client.ts: thin fetch wrapper, all relay calls route through it for consistent auth headers"

requirements-completed: [ACLI-01, ACLI-09, BRFG-01, BRFG-03, BRFG-04]

# Metrics
duration: 2min
completed: 2026-04-19
---

# Phase 08 Plan 01: Shared Report Types + Agent CLI Foundation Summary

**Report type contracts (BriefingReportBody, RalphReportBody, HeartbeatReportBody, ReportEnvelope) in @harnesstune/shared plus agent config/PID management and authenticated HTTP client modules**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-19T14:22:49Z
- **Completed:** 2026-04-19T14:23:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- All 4 report types exported from @harnesstune/shared as single source of truth — prevents schema drift between CLI and extension
- AgentConfig interface with readConfig/writeConfig/PID management wired to .harnesstune/ relative to CWD (per-project isolation)
- RelayClient with Bearer token and X-Agent-Version headers — all relay calls go through this wrapper
- package.json hardened with engines >= 20, files: [dist], typecheck/dev scripts for npm publish readiness

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared report type definitions** - `d746a79` (feat)
2. **Task 2: Create agent config, HTTP client, and update package.json** - `a1ee9bd` (feat)

## Files Created/Modified

- `packages/shared/src/reports.ts` — ReportType union, BriefingReportBody, RalphReportBody, HeartbeatReportBody, ReportEnvelope (with generatedAt + reportId)
- `packages/shared/src/index.ts` — Added `export * from './reports.js'` re-export
- `packages/harnesstune-agent/src/config.ts` — AgentConfig interface, readConfig, writeConfig, writePid, readPid, removePid, getQueueDir; CONFIG_DIR and PID_FILE exported constants
- `packages/harnesstune-agent/src/client.ts` — RelayClient interface, createClient factory with Bearer + X-Agent-Version headers
- `packages/harnesstune-agent/package.json` — Added typecheck/dev scripts, engines >= 20, files: [dist]

## Decisions Made

- Used synchronous `rmSync` in `removePid` instead of dynamic async `import('node:fs')` from the PATTERNS.md example — synchronous is simpler and correct for the shutdown signal path
- `AGENT_VERSION` imported from `index.ts` into `client.ts` (not inlined) — single source of version truth, relay versionMiddleware depends on this header

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (CLI commands: register, start, stop, report) can now import from config.ts and client.ts with stable interfaces
- Plan 03 (sidecar loop) can import HeartbeatReportBody and other types from @harnesstune/shared
- Extension RemoteAdapter (Phase 09) can import report types from @harnesstune/shared — no duplication needed
- Both packages build with zero TypeScript errors

---
*Phase: 08-agent-cli-daily-briefing-reports*
*Completed: 2026-04-19*
