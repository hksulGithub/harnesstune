---
phase: 08-agent-cli-daily-briefing-reports
plan: 03
subsystem: api
tags: [typescript, esm, node, daemon, sidecar, heartbeat, retry-queue, signal-handling]

# Dependency graph
requires:
  - phase: 08-agent-cli-daily-briefing-reports
    plan: 01
    provides: readConfig, writePid, removePid, readPid, getQueueDir, createClient, RelayClient, AgentConfig interfaces
  - phase: 08-agent-cli-daily-briefing-reports
    plan: 02
    provides: CLI entry point wiring start command into argv dispatch
provides:
  - RetryQueue class with disk-persisted bounded queue (48-entry cap, FIFO eviction, 5s rate-limited replay)
  - Full start command: foreground sidecar with 5min heartbeat, configurable poll loop, graceful shutdown
  - Jitter pattern: JITTER_MAX_MS=60s per-cycle + random first-poll delay to prevent thundering herd
  - Exponential backoff: 1s..5min cap on poll errors
  - to_agent message routing via execFileAsync('claude', ['-p', text])
  - Report schedule checking via parseInterval('24h')
  - --dry-run mode with relay health check
  - PID duplicate detection to prevent double-start
affects:
  - 09 (extension RemoteAdapter can now receive heartbeats and send to_agent messages)
  - Phase 09 integration tests (sidecar loop behavior)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recursive setTimeout for variable-delay poll loop (allows jitter + backoff, unlike setInterval)"
    - "All timers unref'd to avoid blocking process exit while signal handlers manage shutdown"
    - "Jitter = baseDelay + Math.floor(Math.random() * JITTER_MAX_MS) applied per poll cycle"
    - "Random first-poll delay = Math.floor(Math.random() * pollInterval) staggers startup thundering herd"
    - "RetryQueue uses timestamp-prefixed filenames for natural sort order (oldest-first)"
    - "shutdown() guarded by shuttingDown flag to prevent double-exit race on multiple signals"

key-files:
  created:
    - packages/harnesstune-agent/src/queue.ts
  modified:
    - packages/harnesstune-agent/src/commands/start.ts

key-decisions:
  - "Recursive setTimeout chosen over setInterval for poll loop — enables variable delay (jitter + backoff) per cycle without drift compensation"
  - "Keep-alive via setInterval(1000).unref() inside the awaited promise — unref'd timers don't hold event loop but the ref'd keepAlive does until shuttingDown"
  - "FIFO eviction in RetryQueue deletes oldest entry before enqueuing new one — prevents unbounded growth even if relay is down indefinitely"
  - "Process.kill(pid, 0) used for PID liveness check — throws ESRCH if process is gone, allowing stale PID cleanup"

patterns-established:
  - "queue.ts: disk-persisted retry queue with timestamp-prefixed filenames for natural sort, cap-and-evict pattern"
  - "start.ts: foreground daemon with unref'd timer pattern — only signal handlers + kept-alive promise hold the process open"

requirements-completed: [ACLI-04, ACLI-05, ACLI-06, ACLI-07, ACLI-11, BRFG-02]

# Metrics
duration: 2min
completed: 2026-04-19
---

# Phase 08 Plan 03: Start Command Sidecar Loop Summary

**Foreground sidecar daemon with 5-min heartbeat (generatedAt + reportId), jittered message polling with exponential backoff, claude CLI routing, disk-persisted 48-entry retry queue, and graceful SIGTERM/SIGINT/SIGHUP shutdown**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-19T14:31:18Z
- **Completed:** 2026-04-19T14:33:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- RetryQueue persists failed report uploads as JSON files in `.harnesstune/queue/`, capped at 48 entries with FIFO eviction, replays with 5s rate limiting on relay recovery
- Start command enters foreground loop: 5-min heartbeat timer (unref'd), recursive setTimeout poll loop with JITTER_MAX_MS=60s per-cycle + random first-poll delay, report schedule check every 60s
- Signal handlers (SIGTERM/SIGINT/SIGHUP) upload disconnected heartbeat with generatedAt + reportId before calling removePid() and exit(0)
- PID duplicate detection prevents double-start using process.kill(pid, 0) liveness check
- --dry-run mode validates config and GET /health reachability without starting the loop
- to_agent messages routed via execFileAsync('claude', ['-p', text]); DELETE sent to relay after processing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create bounded retry queue module** - `8bf6442` (feat)
2. **Task 2: Implement start command lifecycle, heartbeat, and signal handling** - `5d20f25` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/harnesstune-agent/src/queue.ts` — RetryQueue class: enqueue/list/replay/size; MAX_QUEUE_SIZE=48, REPLAY_MIN_INTERVAL_MS=5000; disk-persisted in .harnesstune/queue/
- `packages/harnesstune-agent/src/commands/start.ts` — Full sidecar loop replacing 3-line stub: lifecycle, heartbeat, poll loop with jitter + backoff, message routing, report schedule, retry queue integration, dry-run mode

## Decisions Made

- Used recursive `setTimeout` (not `setInterval`) for the poll loop — enables variable delay per cycle to apply both jitter and exponential backoff without drift correction complexity
- Keep-alive implemented as a setInterval(1000) inside an awaited promise; the interval itself is unref'd but holds a reference until shuttingDown is set — ensures process stays alive while all timers are unref'd
- process.kill(pid, 0) for PID liveness check (signal 0 = existence check, throws ESRCH if not found) — cleaner than parsing /proc or ps output, works cross-platform on Node

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `harnesstune-agent start` is fully implemented and wired into the CLI dispatcher
- Extension RemoteAdapter (Phase 09) can now send to_agent messages and receive heartbeat status updates
- Full package builds with zero TypeScript errors: `pnpm --filter @harnesstune/agent run build`
- CLI usage: `node dist/cli.js` prints help, exits 1; `node dist/cli.js start --dry-run` validates config + relay

## Self-Check

- [x] `packages/harnesstune-agent/src/queue.ts` exists on disk
- [x] `packages/harnesstune-agent/src/commands/start.ts` fully implemented (214 lines, not stub)
- [x] `git log --oneline --all --grep="08-03"` returns commits `8bf6442` and `5d20f25`
- [x] All 25 acceptance criteria: PASS (grep-verified)
- [x] `pnpm --filter @harnesstune/agent run build` exits 0 (zero TypeScript errors)
- [x] `node packages/harnesstune-agent/dist/cli.js` prints usage, exits 1

## Self-Check: PASSED

---
*Phase: 08-agent-cli-daily-briefing-reports*
*Completed: 2026-04-19*
