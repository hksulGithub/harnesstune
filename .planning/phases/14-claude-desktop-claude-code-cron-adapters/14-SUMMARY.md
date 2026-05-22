# Phase 14 Summary: Claude Desktop + Claude Code Cron Adapters

**Status:** Complete
**Date:** 2026-04-23
**Commits:** eea993c, 2e6c3bf, 2d5b149

## Plans Executed

| Plan | Wave | Files | Commit |
|------|------|-------|--------|
| 14-01: Claude Desktop types, mappers, reader | 1 | 3 new | eea993c |
| 14-02: Claude Code Cron types, mappers, crontab, wrapper | 1 | 4 new | 2e6c3bf |
| 14-03: Full plugin implementations + loader wiring | 2 | 3 modified | 2d5b149 |

## Files Created/Modified

### New Files (7)
- `packages/harnesstune-collector/src/plugins/claude-desktop/types.ts` — ScheduledTask, ScheduledTasksFile, SessionFile interfaces
- `packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts` — mapScheduledTask → AgentIdentity, mapSessionToRunReport → RunReport
- `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts` — readScheduledTasks, readSessionFile, scanSessions, getScheduledTasksMtime
- `packages/harnesstune-collector/src/plugins/claude-code/types.ts` — CronRunFile, CrontabEntry interfaces
- `packages/harnesstune-collector/src/plugins/claude-code/mappers.ts` — mapCrontabEntry → AgentIdentity, mapCronRunFile → RunReport
- `packages/harnesstune-collector/src/plugins/claude-code/crontab.ts` — parseCrontab (pure), readCrontab (async, crontab -l)
- `packages/harnesstune-collector/src/plugins/claude-code/wrapper.ts` — generateWrapperScript() bash script generator

### Modified Files (3)
- `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts` — Stub → full ClaudeDesktopPlugin
- `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts` — Stub → full ClaudeCodePlugin
- `packages/harnesstune-collector/src/plugins/loader.ts` — PlatformConfig passthrough to constructors

## Key Design Decisions

- **D-01 (filename-based correlation):** Session files matched to scheduled tasks via scheduledTaskId field, not content parsing
- **D-02 (ignore orphans):** Only sessions with scheduledTaskId are reported; ad-hoc sessions skipped
- **D-03 (mtime guard):** scheduled-tasks.json mtime checked before full parse on each poll
- **D-05 (wrapper has no tokens):** Shell wrapper writes local JSON only; collector handles all relay communication
- **D-09 (--name required):** Wrapper exits with code 2 if --name flag missing
- **D-10 (polling only):** No file watchers — daemon's 60s poll cycle with mtime guard

## Verification

- `tsc --noEmit -p packages/harnesstune-collector/tsconfig.json` — passes clean
- All 7 new files + 3 modified files present and correctly structured
- Pure functions (parseCrontab, generateWrapperScript, all mappers) have zero I/O side effects
- reader.ts wraps all JSON.parse in try/catch for race condition safety
