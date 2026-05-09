# Phase 14: Claude Desktop + Claude Code Cron Adapters - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Two collector plugins for the harnesstune-collector daemon: a Claude Desktop adapter that reads scheduled-tasks.json and correlates local session files to produce run reports, and a Claude Code Cron adapter that provides a shell wrapper script (`harnesstune-wrap`) for cron-based Claude CLI invocations. Both plugins implement the PlatformPlugin interface and report through the existing relay pipeline.

</domain>

<decisions>
## Implementation Decisions

### Session Correlation (Claude Desktop)
- **D-01:** Filename-based correlation — match `local_*.json` session files to scheduled tasks using filename pattern + file modification time. No parsing of session file content for matching purposes.
- **D-02:** Ignore orphan sessions — only report runs that correlate to known scheduled tasks. Interactive/ad-hoc Claude Desktop sessions are out of scope for the collector.
- **D-03:** mtime guard + full parse — check `scheduled-tasks.json` file mtime before reading; skip if unchanged since last poll. When changed, parse the full file and diff against last known state.
- **D-04:** Extract status + duration + error only from session files. Compute duration from file timestamps. Pull error message if present. Skip token/cost data (Claude Desktop doesn't expose these locally). Map to RunReport fields.

### Wrapper Script Design (Claude Code Cron)
- **D-05:** Shell wrapper + collector pickup architecture. `harnesstune-wrap` is a bash script that captures exit code, duration, and output tail. Writes a JSON run file to `~/.harnesstune/cron-runs/`. No network calls, no relay client, no auth token in the wrapper. The Claude Code Cron plugin's `collectRuns(since)` scans that directory, maps files to RunReport[], and deletes processed files. All relay communication stays in the collector daemon.
- **D-06:** Install location is `~/.harnesstune/bin/harnesstune-wrap`. Plugin `setup()` writes the script and makes it executable. User adds to PATH or uses the full path in crontab entries.
- **D-07:** Minimal run file schema: `{ command, exitCode, startedAt, finishedAt, durationMs, outputTail, agentName }`. One file per run, named by timestamp. Plugin maps to RunReport.
- **D-08:** Agent discovery via `crontab -l` parsing — grep for `harnesstune-wrap` entries, extract the wrapped command as agent identity. Sees agents even before their first run.
- **D-09:** Required `--name` flag on the wrapper: `harnesstune-wrap --name 'daily-report' claude -p '...'`. The `--name` value becomes the agentId in the run file and in RunReport. Wrapper exits with usage error if `--name` is missing.

### File Watcher vs Polling
- **D-10:** Polling only — no file watchers in plugins. CDSK-05's intent (detect new/changed scheduled tasks) is satisfied by the daemon's 60s poll cycle combined with the mtime guard (D-03). Phase 12 D-03 (plugins are pure data sources, no watchers) is preserved without exception.

### Claude's Discretion
- Output tail length (number of lines captured by harnesstune-wrap)
- Run file cleanup policy (delete after successful relay upload, or retain for N hours)
- Claude Desktop session file glob pattern specifics
- Error message extraction strategy from session files

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin architecture
- `packages/harnesstune-collector/src/plugins/interface.ts` — PlatformPlugin interface: detect(), setup(), discover(), collectRuns(since)
- `packages/harnesstune-collector/src/plugins/loader.ts` — buildPlugins() static registry, ALL_PLUGINS array
- `packages/harnesstune-collector/src/daemon/scheduler.ts` — runCycle(), cursor tracking, 7-day backfill default, relay upload
- `packages/harnesstune-collector/src/config.ts` — PlatformConfig type, PlatformEntry shape

### Existing stubs (starting points)
- `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts` — Stub: detect checks /Applications/Claude.app, setup prompts for sessionsDir
- `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts` — Stub: detect checks ~/.claude/settings.json, setup returns {}

### Reference implementation
- `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` — Full PlatformPlugin: constructor takes PlatformConfig, setup prompts, discover calls API, collectRuns iterates agents
- `packages/harnesstune-collector/src/plugins/paperclip/client.ts` — Client abstraction pattern
- `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts` — Mapper function pattern (mapAgent, mapTaskSession)
- `packages/harnesstune-collector/src/plugins/paperclip/types.ts` — Platform-specific type interfaces

### Shared types
- `packages/harnesstune-collector/src/types.ts` — AgentIdentity with agentId, name, platform, schedule, lastRunAt, status
- `packages/shared/src/reports.ts` — RunReport with agentId, startedAt, finishedAt, status, durationMs, logExcerpt, errorSummary, tokenUsage, costCents

### Prior phase decisions
- `.planning/phases/12-collector-daemon-easy-setup/12-CONTEXT.md` — D-03: plugins are pure data sources (no watchers, no state), D-04: global config at ~/.harnesstune/collector.json
- `.planning/phases/13-paperclip-adapter/13-CONTEXT.md` — D-01: client abstraction pattern, D-05: cursor-based backfill

### Requirements
- `.planning/REQUIREMENTS.md` lines 200-216 — CDSK-01 through CDSK-06, CCCR-01 through CCCR-05, COLL-05, COLL-06

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PlatformPlugin` interface — both plugins implement this directly
- `buildPlugins()` in loader.ts — register both new plugins here
- Paperclip mapper pattern — reuse for mapScheduledTask→AgentIdentity and mapRunFile→RunReport
- Scheduler cursor tracking — provides `since` parameter to collectRuns automatically
- RetryQueue — handles failed relay uploads for both plugins

### Established Patterns
- Plugin constructor takes `PlatformConfig` (Record<string, unknown>) — cast to plugin-specific config type
- `setup()` uses `readline/promises` for interactive prompts
- `discover()` returns `AgentIdentity[]` with `platform` field set to plugin name
- `collectRuns(since)` returns `RunReport[]`, best-effort error handling with try/catch
- Each plugin gets its own subdirectory under `src/plugins/` for types, mappers, and utilities

### Integration Points
- `loader.ts` ALL_PLUGINS array — add both plugins
- `scheduler.ts` runCycle — already iterates all plugins, no changes needed
- `config.ts` PlatformEntry — both plugins store config here (sessionsDir for Desktop, wrapper path for Cron)

</code_context>

<specifics>
## Specific Ideas

- Wrapper script should be dead simple — the user's reasoning: "Shell captures, collector uploads. Clean separation." No second relay client implementation in a different language.
- `harnesstune-wrap` usage: `harnesstune-wrap --name 'daily-report' claude -p 'Generate the daily report'`
- Run files in `~/.harnesstune/cron-runs/` are ephemeral — processed then deleted by the collector

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-claude-desktop-claude-code-cron-adapters*
*Context gathered: 2026-04-23*
