---
phase: 17
plan: 1
title: AlertEngine + types + stale/failure detection logic
status: complete
commits:
  - 429e89d  # feat(alerts): add alert types and AlertConfig to WorkspaceRecord
  - c9994f1  # feat(alerts): implement AlertEngine with stale/failure detection
files_modified:
  - src/types/alerts.ts
  - src/types/workspace.ts
  - src/alerts/AlertEngine.ts
  - src/alerts/index.ts
  - package.json
---

# Plan 1 Summary: AlertEngine + Types + Stale/Failure Detection Logic

## What was done

### Task 1: Alert types and AlertConfig
- Created `src/types/alerts.ts` with `AlertConfig`, `AlertState`, `AlertTransition`, `AlertCycleSummary`, `ALERT_DEFAULTS`
- Added `alertConfig?: AlertConfig` to `WorkspaceRecord` in `src/types/workspace.ts`
- Added `'alertConfig'` to `IWorkspaceRegistry.update()` Pick type

### Task 2: AlertEngine implementation
- Created `src/alerts/AlertEngine.ts` implementing `vscode.Disposable`
- In-memory `Map<string, AlertState>` for state transition tracking
- `start()` runs `evaluate()` immediately then every 60s via setInterval
- `evaluate()` iterates workspaces, checks alertConfig.enabled, computes staleness via cron-parser, checks health from FleetAgentSummary
- `computeStaleThreshold()` uses `CronExpressionParser.parse()` (cron-parser v5 API)
- Created `src/alerts/index.ts` barrel export
- Added `cron-parser` dependency via pnpm

## Deviations from plan
- Used `CronExpressionParser.parse()` (cron-parser v5) instead of `parseExpression()` (v4) — functionally identical
