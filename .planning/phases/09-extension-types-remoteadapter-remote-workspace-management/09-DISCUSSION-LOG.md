# Phase 09 Discussion Log

**Date:** 2026-04-19
**Areas discussed:** 2 of 4 identified

## Gray Areas Identified

1. **RemoteAdapter Polling** — polling interval, event transformation, error handling, cursor management (SELECTED)
2. **Add Remote Workspace Flow** — QuickInput UX, token storage, sidebar layout, context menus (SELECTED)
3. Report Type Extensions — ReportDocument types, timeline card components, convergence charts (SKIPPED — standard patterns, Phase 10 scope)
4. Async Chat Integration — message compose/receive, threaded display, read status (SKIPPED — Phase 10 scope)

## Area 1: RemoteAdapter Polling

**Q1: Polling interval?**
→ 30s default, configurable per-workspace. Balances freshness vs relay load.

**Q2: How to transform relay reports into AgentEvents?**
→ Synthetic `AgentEvent` with `type: 'remote_report'` wrapping `ReportEnvelope`. No forced mapping to existing event types.

**Q3: Error handling for relay unreachable?**
→ Exponential backoff (30s→60s→120s→5min cap) + `relay_unreachable` status badge. 401 stops polling with `auth_error` status.

**Q4: Cursor management for paginated fetching?**
→ In-memory cursor + persist to `WorkspaceRecord.lastCursor` on each successful poll. Resume from persisted cursor on restart.

## Area 2: Add Remote Workspace Flow

**Q1: QuickInput flow structure?**
→ 3-step sequential: relay URL → token (password mode) → auto health-check + save. Auto-name from channel metadata.

**Q2: Token storage pattern?**
→ Per-workspace SecretStore key: `harnesstune.relay.{workspaceId}`. Delete on workspace removal.

**Q3: Sidebar layout for remote workspaces?**
→ Mixed flat list with `$(cloud)` codicon badge. No separate Remote section.

**Q4: Context menu actions?**
→ Message Agent / Configure / Remove. Same pattern as local workspaces + Message Agent first item.
