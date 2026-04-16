---
phase: 02-claude-code-adapter-dashboard
plan: "02"
subsystem: database-controls-notifications
tags: [sqlite, sql.js, agent-control, notifications, tdd]
dependency_graph:
  requires: [02-01]
  provides: [AgentEventStore, AgentControlManager, NotificationService]
  affects: [02-03, 02-04]
tech_stack:
  added: [sql.js SQLite in-process database]
  patterns: [atomic tmp+rename flush, EventEmitter subscription pattern, PreToolUse gate checker, SIGTERM PID validation]
key_files:
  created:
    - src/database/AgentEventStore.ts
    - src/database/index.ts
    - src/controls/AgentControlManager.ts
    - src/controls/index.ts
    - src/notifications/NotificationService.ts
    - src/notifications/index.ts
    - tests/database/AgentEventStore.test.ts
    - tests/controls/AgentControlManager.test.ts
    - tests/notifications/NotificationService.test.ts
  modified:
    - tests/__mocks__/vscode.ts
decisions:
  - "sql.js init() called without WASM locateFile in tests — extensionPath param left optional for clean test isolation"
  - "AgentEventStore validates required fields before INSERT to prevent silent data corruption"
  - "isPaused() is synchronous boolean — PreToolUse gate must not await anything in hot path"
  - "vscode EventEmitter mock updated to support real subscriber pattern — prior mock was a no-op stub"
  - "NotificationService.handleEvent is async — awaits showErrorMessage to capture user's 'View Details' selection"
metrics:
  duration: "~5 min"
  completed_date: "2026-04-16"
  tasks_completed: 2
  files_created: 9
  files_modified: 1
  tests_added: 21
  commits:
    - hash: "8cf57ba"
      message: "feat(02-02): AgentEventStore with sql.js SQLite persistence"
    - hash: "3ecc275"
      message: "feat(02-02): AgentControlManager, NotificationService, and updated vscode mock"
---

# Phase 02 Plan 02: Data Storage, Controls, and Notifications Summary

**One-liner:** sql.js SQLite event store with atomic flush, session pause/resume/stop with SIGTERM gate, and error-to-toast notification routing.

## What Was Built

### Task 1: AgentEventStore (sql.js SQLite)

`src/database/AgentEventStore.ts` — Persistent event storage using sql.js in-process SQLite.

- `init()` loads existing DB from `agent-events.sqlite` on disk or creates new one
- Schema: `agent_events` table with 14 columns; indexes on `session_id`, `workspace_id`, `timestamp DESC`
- `insertEvent(event)` validates required fields, serializes `toolInput` and `raw` as JSON
- `getEventsBySession(sessionId, limit)` returns events in timestamp DESC order
- `getEventsByWorkspace(workspaceId, limit)` filters and paginates by workspace
- `getSessionSummary(sessionId)` aggregates token counts, tool uses, and error counts per session
- `getWorkspaceSummary(workspaceId)` aggregates same metrics across all workspace sessions
- `flush()` exports DB with atomic `writeFileSync(tmp)` + `renameSync(tmp, target)` — crash safe
- `dispose()` flushes then closes

### Task 2: AgentControlManager + NotificationService

`src/controls/AgentControlManager.ts` — In-memory session state map with lifecycle controls.

- `registerSession(sessionId, workspaceId)` creates `AgentSession` with `controlState: 'running'`
- `pauseAgent(sessionId)` sets `controlState: 'paused'` and records `pausedAt`; throws if already paused or not found
- `resumeAgent(sessionId)` restores `controlState: 'running'`, clears `pausedAt`; throws if not paused
- `stopAgent(sessionId)` validates PID alive via `process.kill(pid, 0)` then sends `SIGTERM`; no-op if no PID
- `isPaused(sessionId)` — synchronous boolean for PreToolUse gate (no await)
- `onDidChangeSession` EventEmitter fires on all state transitions
- `updateSessionPid(sessionId, pid)` stores PID after session startup

`src/notifications/NotificationService.ts` — Event-to-notification router.

- `PostToolUseFailure` / `StopFailure` → `vscode.window.showErrorMessage` toast + increments `errorCount` via registry
- `SessionStart` → updates workspace `status: 'running'` and increments `runningAgentCount` (no toast)
- `SessionEnd` / `Stop` → decrements `runningAgentCount`, sets `status: 'idle'` if count reaches 0 (no toast)
- All other events: silent (no notification, no registry update)
- `showInformationMessage` is never called — NOTF-02 compliance maintained

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vscode EventEmitter mock was a no-op stub**
- **Found during:** Task 2 (onDidChangeSession test failed with timeout)
- **Issue:** The existing `tests/__mocks__/vscode.ts` had `EventEmitter.event = () => {}` — subscriptions were silently dropped, so `onDidChangeSession` callbacks never fired
- **Fix:** Updated mock to maintain a real listener array with subscribe/unsubscribe and `fire()` that iterates all listeners
- **Files modified:** `tests/__mocks__/vscode.ts`
- **Commit:** `3ecc275`

## Verification Results

```
npx jest tests/database/ tests/controls/ tests/notifications/
  Test Suites: 3 passed, 3 total
  Tests:       21 passed, 21 total
```

```
npx tsc --noEmit -p tsconfig.extension.json
  (no output — clean)
```

Acceptance criteria checks:
- `CREATE TABLE IF NOT EXISTS agent_events` — confirmed
- `idx_session`, `idx_workspace`, `idx_timestamp` indexes — confirmed
- `insertEvent`, `getEventsBySession`, `getSessionSummary`, `flush()`, `renameSync` — confirmed
- `pauseAgent`, `resumeAgent`, `stopAgent`, `isPaused`, `process.kill`, `SIGTERM`, `onDidChangeSession` — confirmed
- `showErrorMessage` for errors, no `showInformationMessage` for info events — confirmed

## Self-Check: PASSED

Files verified present:
- src/database/AgentEventStore.ts — FOUND
- src/database/index.ts — FOUND
- src/controls/AgentControlManager.ts — FOUND
- src/controls/index.ts — FOUND
- src/notifications/NotificationService.ts — FOUND
- src/notifications/index.ts — FOUND
- tests/database/AgentEventStore.test.ts — FOUND
- tests/controls/AgentControlManager.test.ts — FOUND
- tests/notifications/NotificationService.test.ts — FOUND

Commits verified:
- 8cf57ba — FOUND (AgentEventStore)
- 3ecc275 — FOUND (AgentControlManager + NotificationService)
