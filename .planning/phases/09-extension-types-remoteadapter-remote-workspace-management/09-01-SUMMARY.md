---
phase: 09-extension-types-remoteadapter-remote-workspace-management
plan: 01
subsystem: adapters
tags: [relay, remote-workspace, polling, backoff, secret-store, vscode-extension]

# Dependency graph
requires:
  - phase: 06-type-consolidation-monorepo
    provides: BackendType='remote', WorkspaceMode discriminant, pnpm monorepo with @harnesstune/shared
  - phase: 08-agent-cli-daily-briefing-reports
    provides: ReportEnvelope, RalphReportBody, BriefingReportBody, HeartbeatReportBody in @harnesstune/shared
provides:
  - Extension-side report types (RalphLoopReport, DailyBriefingReport, RemoteReportEvent, computeRalphDelta)
  - RelayClient fetch wrapper with Bearer auth, timeout, backoff-aware polling
  - RemoteAdapter implementing AgentBackendAdapter with 30s polling and exponential backoff
  - SecretStore relay token methods (setRelayToken, getRelayToken, deleteRelayToken)
  - WorkspaceRegistry remote workspace add() support with sentinel rootPath
  - WorkspaceRecord extended with relayUrl, channelId, pollInterval, lastCursor fields
  - WorkspaceStatus expanded with stale, relay_unreachable, auth_error variants
  - HostToWebviewMessage + WebviewToHostMessage extended with report and remote workspace message types
affects: [09-02-PLAN, extension.ts commands, SidebarViewProvider]

# Tech tracking
tech-stack:
  added: [@harnesstune/shared added as workspace dependency to root extension package]
  patterns:
    - Synthetic AgentEvent emission — RemoteAdapter fires AgentEvents with eventType='RemoteReport', raw payload is ReportEnvelope
    - Exponential backoff — consecutive error counter drives 2^n multiplier up to 5-minute cap
    - Sentinel rootPath — remote workspaces use 'remote://{channelId}' to skip absolute path validation
    - RELAY_PREFIX pattern — SecretStore uses 'harnesstune.relay.{workspaceId}' key matching existing 'harnesstune.apiKey.{provider}' pattern

key-files:
  created:
    - src/types/reports.ts
    - src/relay/RelayClient.ts
    - src/relay/index.ts
    - src/adapters/RemoteAdapter.ts
  modified:
    - src/types/agent.ts
    - src/types/workspace.ts
    - src/types/messages.ts
    - src/types/index.ts
    - src/types/status.ts
    - src/secrets/SecretStore.ts
    - src/registry/WorkspaceRegistry.ts
    - src/adapters/index.ts
    - package.json

key-decisions:
  - "res.json() returns unknown in strict TS — all relay response bodies cast via 'as Promise<Type>' pattern"
  - "doFetch() private method avoids shadowing globalThis.fetch — named doFetch not fetch"
  - "@harnesstune/shared not linked in node_modules — added as 'workspace:*' dependency to root package.json via pnpm"
  - "STATUS_INDICATORS Record must be exhaustive — added stale, relay_unreachable, auth_error entries to status.ts (Rule 1 auto-fix)"

patterns-established:
  - "Pattern: Relay token storage key = 'harnesstune.relay.{workspaceId}' — per-workspace, matches existing apiKey pattern"
  - "Pattern: Remote workspace sentinel rootPath = 'remote://{channelId}' — distinguishes from absolute local paths"
  - "Pattern: RemoteReport AgentEvent — eventType='RemoteReport', raw = { type: 'remote_report', report: ReportEnvelope }"

requirements-completed: [RLPH-01, RLPH-02, RLPH-03, RLPH-04, RWKS-03, RWKS-08, RWKS-09]

# Metrics
duration: 25min
completed: 2026-04-20
---

# Phase 09 Plan 01: Extension Types + RemoteAdapter + Remote Workspace Foundation Summary

**RelayClient fetch wrapper and RemoteAdapter polling loop wired into AgentBackendAdapter interface, with relay token SecretStore methods and remote-workspace registry support**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-20T01:08:58+09:00
- **Completed:** 2026-04-20T01:33:00+09:00
- **Tasks:** 2
- **Files modified:** 13 (4 created, 9 modified)

## Accomplishments

- Created `src/types/reports.ts` with extension-side report types (RalphLoopReport, DailyBriefingReport, RemoteReportEvent) and delta computation helper
- Created `src/relay/RelayClient.ts` — thin fetch wrapper with Bearer auth, AbortController timeout, redacted debug logging, and all relay API endpoints
- Created `src/adapters/RemoteAdapter.ts` implementing `AgentBackendAdapter` with 30s polling, exponential backoff (30s→60s→120s→5min cap), 401 vs network error distinction, heartbeat staleness detection, and synthetic `RemoteReport` AgentEvent emission
- Extended `SecretStore` with `setRelayToken`, `getRelayToken`, `deleteRelayToken` using `harnesstune.relay.{workspaceId}` key pattern
- Extended `WorkspaceRegistry.add()` to accept remote workspace options, skip path validation, and use sentinel `remote://{channelId}` rootPath
- Extended `WorkspaceRecord`, `WorkspaceStatus`, `IWorkspaceRegistry`, `HostToWebviewMessage`, `WebviewToHostMessage` with remote workspace fields and message types

## Task Commits

1. **Task 1: Types, SecretStore, Registry** - `5f1b825` (feat)
2. **Task 2: RelayClient, RemoteAdapter** - `933fd22` (feat)

## Files Created/Modified

- `src/types/reports.ts` — RalphLoopReport, DailyBriefingReport, RemoteReportEvent, computeRalphDelta
- `src/relay/RelayClient.ts` — fetch wrapper: checkHealth, getReports, getReport, postMessage, getChannel, discoverChannelId
- `src/relay/index.ts` — barrel export for relay module
- `src/adapters/RemoteAdapter.ts` — AgentBackendAdapter polling loop with backoff and staleness detection
- `src/types/agent.ts` — added 'RemoteReport' to AgentEventType union
- `src/types/workspace.ts` — expanded WorkspaceStatus, WorkspaceRecord, IWorkspaceRegistry interfaces
- `src/types/messages.ts` — added reports:* and workspace:addRemote/messageAgent message types; imported ReportEnvelope
- `src/types/index.ts` — added `export * from './reports'`
- `src/types/status.ts` — added STATUS_INDICATORS entries for stale, relay_unreachable, auth_error
- `src/secrets/SecretStore.ts` — added RELAY_PREFIX and three relay token methods
- `src/registry/WorkspaceRegistry.ts` — remote workspace add() support and update() relay fields
- `src/adapters/index.ts` — added RemoteAdapter export
- `package.json` — added @harnesstune/shared workspace dependency

## Decisions Made

- `res.json()` returns `unknown` under strict TypeScript — used `as Promise<Type>` casts in RelayClient throughout
- Named the internal fetch method `doFetch` to avoid shadowing `globalThis.fetch`
- `@harnesstune/shared` was not linked in root `node_modules` despite pnpm workspace config — fixed by explicitly running `pnpm add -w "@harnesstune/shared@workspace:*"`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exhaustive STATUS_INDICATORS record after WorkspaceStatus expansion**
- **Found during:** Task 1 verification (tsc --noEmit)
- **Issue:** `STATUS_INDICATORS: Record<WorkspaceStatus, StatusIndicator>` in `status.ts` was missing entries for `stale`, `relay_unreachable`, `auth_error` after expanding `WorkspaceStatus`
- **Fix:** Added three new status indicator entries with appropriate colors and shapes (warning orange for stale, error red for relay_unreachable and auth_error)
- **Files modified:** `src/types/status.ts`
- **Verification:** TypeScript error TS2739 eliminated
- **Committed in:** `5f1b825` (Task 1 commit)

**2. [Rule 3 - Blocking] Added @harnesstune/shared as workspace dependency to root package**
- **Found during:** Task 1 verification (tsc --noEmit)
- **Issue:** `src/types/messages.ts` and `src/types/reports.ts` import from `@harnesstune/shared` but it was not listed as a dependency in root `package.json` and was not symlinked in `node_modules`
- **Fix:** Ran `pnpm add -w "@harnesstune/shared@workspace:*"` to link the package
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** TypeScript error TS2307 eliminated
- **Committed in:** `5f1b825` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- 4 pre-existing TypeScript errors in `extension.ts(662)`, `ChatManager.ts(160)`, and `SidebarViewProvider.ts(42,43)` remain. Verified pre-existing via `git stash` test. Documented in `deferred-items.md`. Will be resolved in Plan 09-02 when those files are updated for remote workspace commands and sidebar.

## Next Phase Readiness

- All foundational types, RelayClient, RemoteAdapter, SecretStore relay methods, and registry remote-add support are in place
- Plan 09-02 can now wire: `harnesstune.addRemoteWorkspace` command using the 3-step QuickInput flow, connect RemoteAdapter to registry on workspace connect, persist cursors, update sidebar with cloud badge
- No blockers for Plan 09-02

---
*Phase: 09-extension-types-remoteadapter-remote-workspace-management*
*Completed: 2026-04-20*
