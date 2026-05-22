# Phase 14: Claude Desktop + Claude Code Cron Adapters — Research

**Researched:** 2026-04-23
**Status:** Complete

---

## 1. Existing Code Patterns to Follow

### 1.1 PlatformPlugin Interface

**File:** `packages/harnesstune-collector/src/plugins/interface.ts` (lines 14–43)

The interface is fully locked from Phase 12. Both Phase 14 plugins implement exactly:

```typescript
interface PlatformPlugin {
  readonly id: string;
  readonly displayName: string;
  detect(): Promise<boolean>;
  setup(existing?: PlatformConfig): Promise<PlatformConfig>;
  discover(): Promise<AgentIdentity[]>;
  collectRuns(since: Date): Promise<RunReport[]>;
}
```

`PlatformConfig = Record<string, unknown>` — plugins cast to their own typed config internally.

### 1.2 Stub Starting Points

**Claude Desktop stub:** `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts`

- `detect()` already checks `/Applications/Claude.app`, `~/Applications/Claude.app`, and `~/Library/Application Support/Claude` (lines 30–34). This is correct and complete — no changes needed.
- `setup()` already prompts for `sessionsDir` with a sensible default (`~/Library/Application Support/Claude/local-agent-mode-sessions/`) (lines 38–49). Phase 14 extends this to also prompt for `orgId`/`userId` (per CDSK-06).
- `discover()` and `collectRuns()` are stubs that return `[]`. Phase 14 replaces these.

**Claude Code stub:** `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts`

- `detect()` checks for `~/.claude/settings.json` or common `claude` binary locations (lines 19–29). This is correct and complete.
- `setup()` currently returns `{}` with a no-config message (lines 31–35). Phase 14 adds wrapper installation to `setup()`.
- `discover()` and `collectRuns()` are stubs that return `[]`. Phase 14 replaces these.

### 1.3 Paperclip Plugin as Reference Implementation

**File:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts`

The established plugin pattern:
1. **Constructor** receives `PlatformConfig | undefined`, casts and initializes internal state (lines 28–35).
2. **`setup()`** uses `readline/promises` (`createInterface({ input, output })`), closes `rl` in `finally` block (lines 48–93).
3. **`discover()`** returns `AgentIdentity[]` with `platform` field set to plugin `id` (lines 95–101).
4. **`collectRuns(since)`** is best-effort: inner try/catch per enrichment step so partial failure doesn't abort the batch (lines 103–147).

**Mapper pattern:** `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts`

- `mapAgent(agent)` → `AgentIdentity` — sets all 6 fields including `platform: 'paperclip'` (line 9).
- `mapTaskSession(session)` → `RunReport` — computes `durationMs` from timestamps if not provided (lines 18–39).
- Functions are pure — no side effects, no I/O, easily unit-testable.

**Type definitions:** `packages/harnesstune-collector/src/plugins/paperclip/types.ts` — each platform gets its own interface file for raw API/file shapes.

**File organization to replicate:**
```
src/plugins/claude-desktop/
  types.ts      # ScheduledTask, SessionFile interfaces
  mappers.ts    # mapScheduledTask → AgentIdentity, mapSession → RunReport
  reader.ts     # file I/O: readScheduledTasks(), readSessions(), findSessionsForTask()

src/plugins/claude-code/
  types.ts      # CronRunFile, CrontabEntry interfaces
  mappers.ts    # mapCronRunFile → RunReport, mapCrontabEntry → AgentIdentity
  wrapper.ts    # generateWrapperScript() pure function
```

### 1.4 Loader Registration

**File:** `packages/harnesstune-collector/src/plugins/loader.ts` (lines 17–37)

`buildPlugins()` currently instantiates `ClaudeDesktopPlugin()` and `ClaudeCodePlugin()` with no config (lines 31–32). Phase 14 must change this to pass `platformConfig`:

```typescript
// Before (stub):
new ClaudeDesktopPlugin()
new ClaudeCodePlugin()

// After (Phase 14):
new ClaudeDesktopPlugin(platformConfigs['claude-desktop'])
new ClaudeCodePlugin(platformConfigs['claude-code'])
```

Both plugins need to accept a constructor parameter for config access at runtime.

### 1.5 Scheduler — No Changes Required

**File:** `packages/harnesstune-collector/src/daemon/scheduler.ts`

`runCycle()` (lines 20–125) already handles the full lifecycle for any plugin:
- Calls `plugin.discover()` and registers agents with relay (lines 39–61)
- Calls `plugin.collectRuns(since)` (line 65)
- Uploads each run as an envelope (lines 68–90)
- Advances the cursor to the latest `finishedAt` (lines 93–99)
- Wraps each plugin in try/catch so one plugin failure doesn't abort others (lines 100–103)

No changes needed to `scheduler.ts` for Phase 14.

### 1.6 Config Module

**File:** `packages/harnesstune-collector/src/config.ts`

`COLLECTOR_DIR = join(homedir(), '.harnesstune')` (line 33) — this is where the wrapper dir and run files live. Both Phase 14 plugins use this constant:
- Wrapper install path: `~/.harnesstune/bin/harnesstune-wrap`
- Run file drop dir: `~/.harnesstune/cron-runs/`

`PlatformEntry.config: Record<string, unknown>` (lines 6–10) — stores per-plugin config. No type changes needed.

### 1.7 RetryQueue — No Changes Required

**File:** `packages/harnesstune-collector/src/queue.ts`

The queue is consumed by `scheduler.ts` transparently. Phase 14 plugins don't interact with it directly — the scheduler handles retry on their behalf.

### 1.8 AgentIdentity and RunReport Types

**`packages/harnesstune-collector/src/types.ts`** — `AgentIdentity` has 6 required fields: `agentId`, `name`, `platform`, `schedule` (nullable string), `lastRunAt` (nullable ISO string), `status` (string).

**`packages/shared/src/reports.ts` lines 43–58** — `RunReport` has: `agentId`, `startedAt`, `finishedAt`, `status` (`success|failure|timeout|running`), `durationMs`, and optional `logExcerpt`, `errorSummary`, `tokenUsage`, `costCents`.

---

## 2. Claude Desktop Session File Format — Actual Findings

These findings are from direct inspection of the live machine at `~/Library/Application Support/Claude/local-agent-mode-sessions/`.

### 2.1 Directory Structure

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  <orgId>/                          # UUID (e.g. 7a63edc4-...)
    <userId>/                       # UUID (e.g. 19dc0e72-...)
      scheduled-tasks.json          # task registry
      local_<uuid>.json             # one session metadata file per session
      local_<uuid>/                 # session directory (audit.jsonl, outputs/, uploads/)
        audit.jsonl
        outputs/
        uploads/
  skills-plugin/                    # NOT a real org — skills framework artifact
    <userId>/                       # shares userId but NO scheduled-tasks.json
```

**Key finding:** `skills-plugin` is a synthetic "org" used by the Claude Desktop skills extension. It has no `scheduled-tasks.json`. The plugin must skip it. Discovery should glob for `<orgId>/<userId>/scheduled-tasks.json` where `orgId` is a UUID pattern — `skills-plugin` fails that check.

**orgId/userId discovery:** There are currently one orgId and one userId on this machine. CDSK-06 says the plugin should prompt the user to select if multiple exist. The `setup()` implementation should glob `~/Library/Application Support/Claude/local-agent-mode-sessions/*/*/scheduled-tasks.json` and enumerate unique paths.

### 2.2 `scheduled-tasks.json` Format

```json
{
  "scheduledTasks": [
    {
      "id": "test-1",
      "cronExpression": "0 9 * * *",
      "enabled": false,
      "filePath": "/Users/hksul/Documents/Claude/Scheduled/test-1/SKILL.md",
      "model": "claude-sonnet-4-6",
      "createdAt": 1772950072138,
      "lastRunAt": "2026-04-06T00:08:26.945Z",
      "lastScheduledFor": "2026-04-06T00:00:00.000Z",
      "approvedPermissions": [ { "toolName": "mcp__ccxt-mcp__fetchTicker" } ],
      "disableJitter": false
    }
  ]
}
```

**Key fields for `discover()`:**
- `id` → `AgentIdentity.agentId`
- `id` (human display) → `AgentIdentity.name` (no separate display name field)
- `cronExpression` → `AgentIdentity.schedule`
- `enabled` → `AgentIdentity.status` (`enabled ? 'active' : 'paused'`)
- `lastRunAt` → `AgentIdentity.lastRunAt` (ISO string, already formatted)

**Note on `filePath`:** Points to the SKILL.md file. Not needed for Phase 14 — the session files contain the `scheduledTaskId` for direct correlation.

**Note on `createdAt`:** Epoch milliseconds (unlike session `lastRunAt` which is ISO).

### 2.3 Session File Format (`local_<uuid>.json`)

Complete schema observed across 55 session files:

```typescript
interface SessionFile {
  sessionId: string;           // 'local_<uuid>'
  scheduledTaskId?: string;    // set iff session was triggered by a scheduled task
  sessionType?: 'scheduled';   // present on some (not all) scheduled sessions
  createdAt: number;           // epoch ms — use as startedAt
  lastActivityAt: number;      // epoch ms — use as finishedAt
  error?: string;              // present if session failed (rate limit, network, etc.)
  isArchived: boolean;
  title: string;               // human readable, e.g. "Mar 9 – Test 1"
  model: string;               // e.g. "claude-sonnet-4-6"
  // ... many other fields irrelevant to Phase 14
}
```

**Correlation key (critical finding — corrects D-01):**

D-01 specified "filename-based correlation," but actual data shows sessions have a direct `scheduledTaskId` field that equals the task's `id`. This makes correlation trivial:

```
session.scheduledTaskId === task.id  →  this session belongs to this task
```

Sessions where `scheduledTaskId` is absent or falsy are ad-hoc/interactive (D-02 says ignore these). Out of 55 total sessions on this machine: **39 are scheduled, 16 are ad-hoc.**

**Status inference (no explicit status field):**
- `error` field present → `status: 'failure'`, `errorSummary: session.error`
- `error` field absent → `status: 'success'`
- No `timeout` status can be inferred from session files directly

**Duration computation:**
- `durationMs = session.lastActivityAt - session.createdAt`
- Both are epoch milliseconds — subtraction yields ms directly
- Accuracy: `lastActivityAt` lags `createdAt` by 1–2 seconds beyond actual session end (mtime is slightly later than `lastActivityAt`), but this is acceptable

**Error message varieties observed:**
- `"You've hit your limit · resets 4am (Asia/Seoul)"` — rate limit
- `"API Error: Unable to connect to API (ECONNRESET)"` — network
- `"Unable to start session. Check your internet connection and try again."` — startup failure
- `"The session ended unexpectedly. Please try again."` — crash

**What's NOT available in session files:**
- Token usage (`inputTokens`, `outputTokens`) — not stored
- Cost data — not stored
- Explicit `status` field — must infer
- No `crontab -l`-style schedule info — comes from `scheduled-tasks.json` only

### 2.4 The `audit.jsonl` Directory

Each `local_<uuid>/` directory contains `audit.jsonl` with raw JSONL conversation messages. Phase 14 does NOT need this file. The session metadata `.json` file has all required fields.

### 2.5 The mtime Guard (D-03)

The `scheduled-tasks.json` file's mtime is `2026-04-06T07:09:18 KST` — it was last modified when a task run completed (corroborated by `lastRunAt: "2026-04-06T00:08:26.945Z"`). The plugin should:

1. On each poll cycle: `stat(scheduled-tasks.json).mtime`
2. Compare with `lastKnownMtime` stored in plugin instance
3. If unchanged: skip full parse (return cached `AgentIdentity[]`)
4. If changed: parse full file, update cache, return new `AgentIdentity[]`

**Important:** Mtime for session files (`.json`) is approximately equal to `lastActivityAt` + 1 second, which means the mtime is a reliable proxy for "session completed around this time."

---

## 3. crontab -l Parsing Strategy

### 3.1 Output Format

crontab format (standard, macOS/Linux):
```
# comment line — skip
SHELL=/bin/bash        # env var assignment — skip (has = but no leading whitespace/time fields)
0 9 * * * command args # standard entry: 5 time fields then command
@reboot command        # special string entry: @keyword then command
```

### 3.2 Exit Code Behavior

- User has crontab: exit code 0, stdout = crontab content
- User has no crontab: exit code 1, stderr = `"crontab: no crontab for <user>"`
- macOS only: `crontab -l` on a system with cron disabled outputs to stderr and exits 1

The plugin must treat exit code 1 as "no crontab" (return empty `[]`) rather than a hard error.

### 3.3 Filter Algorithm for D-08

```
for each line in crontab output:
  skip if: blank, starts with '#', matches /^\s*\w+=/ (env var)

  if line contains 'harnesstune-wrap':
    extract --name <value>
    extract cron expression (fields 0–4 for standard entries, '@reboot' for special)
    build AgentIdentity
```

**`--name` extraction:** The wrapper uses `--name 'value'` or `--name value`. The parser must handle both quoted and unquoted forms. A regex like `/--name\s+['"]?([^'"]+?)['"]?(?:\s|$)/` works.

**`@reboot` handling:** If the crontab line starts with `@reboot`, the cron expression field should be stored as `'@reboot'` in `AgentIdentity.schedule`. No other `@` aliases are expected with harnesstune-wrap, but any starting with `@` can be handled uniformly.

**cron expression extraction for standard entries:** Split on whitespace, fields 0–4 are the cron expression, join back with space: `fields.slice(0, 5).join(' ')`.

**Path variations for harnesstune-wrap:**
- `harnesstune-wrap` (if `~/.harnesstune/bin` is on PATH)
- `/Users/hksul/.harnesstune/bin/harnesstune-wrap` (absolute path)
- `~/.harnesstune/bin/harnesstune-wrap` (tilde — cron expands tildes inconsistently)

The filter should check if the command portion of the line contains `harnesstune-wrap` as a substring (not just the exact binary name), after splitting off the time fields.

### 3.4 `execFile` vs `exec`

Use `execFile('crontab', ['-l'])` from `node:child_process` (promisified with `util.promisify`). This avoids shell injection and is consistent with the `install.ts` precedent (`execFileAsync` used for `launchctl` at `packages/harnesstune-collector/src/commands/install.ts` lines 8–9).

---

## 4. Integration Points

### 4.1 loader.ts — Change Constructor Call Signature

**File:** `packages/harnesstune-collector/src/plugins/loader.ts` (lines 29–32)

Current:
```typescript
new ClaudeDesktopPlugin()
new ClaudeCodePlugin()
```

Must become:
```typescript
new ClaudeDesktopPlugin(platformConfigs['claude-desktop'])
new ClaudeCodePlugin(platformConfigs['claude-code'])
```

Both plugins should accept `PlatformConfig | undefined` in their constructors.

### 4.2 claude-desktop.ts — Replace Stub with Full Implementation

Move the full implementation from `stubs/claude-desktop.ts` to either:
- In-place upgrade of the stub (replace its `discover()` and `collectRuns()` bodies and update constructor), **or**
- Create `src/plugins/claude-desktop/index.ts` (full plugin) and update `stubs/claude-desktop.ts` to re-export — this mirrors the Paperclip pattern where `stubs/paperclip.ts` IS the full implementation

**Recommendation:** Upgrade the stub in-place. The stub is already at the correct path imported by `loader.ts`. Adding a `claude-desktop/` subdirectory keeps types, mappers, and I/O helpers separated from the main plugin class, which is cleaner.

**Config shape for claude-desktop:**
```typescript
{
  sessionsDir: string   // ~/Library/Application Support/Claude/local-agent-mode-sessions/<orgId>/<userId>
}
```

The `setup()` method auto-discovers `orgId/userId` pairs (glob for `scheduled-tasks.json`), presents choices if multiple exist, and stores the full path in `sessionsDir`.

### 4.3 claude-code.ts — Replace Stub with Full Implementation

**Config shape for claude-code:**
```typescript
{
  wrapperPath: string       // ~/.harnesstune/bin/harnesstune-wrap (set during setup)
  cronRunsDir?: string      // ~/.harnesstune/cron-runs (default, no prompt needed)
}
```

`setup()` generates the wrapper script, writes it to `~/.harnesstune/bin/harnesstune-wrap`, `chmod 755`, and prints instructions for adding to PATH and updating crontab.

### 4.4 New Plugin Files

```
packages/harnesstune-collector/src/plugins/
  claude-desktop/
    types.ts       # ScheduledTask, SessionFile raw interfaces
    mappers.ts     # mapScheduledTask, mapSession, mapSessionToRunReport
    reader.ts      # readScheduledTasks(), scanSessions(), filterByScheduledTaskId()
  claude-code/
    types.ts       # CronRunFile interface
    mappers.ts     # mapCronRunFile → RunReport, mapCrontabEntry → AgentIdentity
    wrapper.ts     # generateWrapperScript() → string (pure function)
    crontab.ts     # parseCrontab(output: string) → CrontabEntry[]
```

### 4.5 New Directory at Runtime

`~/.harnesstune/cron-runs/` — the Claude Code plugin's `setup()` (or `discover()` fallback) creates this directory. The wrapper script writes run JSON files here. `collectRuns()` scans this dir, processes files, deletes after successful mapping.

`~/.harnesstune/bin/` — created by `setup()` when writing `harnesstune-wrap`.

---

## 5. Risk Areas and Unknowns

### 5.1 HIGH: `scheduled-tasks.json` File Lock / Race Condition

Claude Desktop writes `scheduled-tasks.json` during and after task runs. If the collector reads mid-write, it may get a partial JSON. Mitigation: wrap `JSON.parse` in try/catch; on parse failure, log a warning and skip the cycle (keep last known state). The mtime guard (D-03) already means the file is only read when changed.

### 5.2 HIGH: Sessions Still In Progress

A session file may have `createdAt` in the past but `lastActivityAt` very recent, meaning the task is still running. If `collectRuns(since)` picks up a session where `lastActivityAt` is within the last 30–60 seconds, it might report an in-progress session as `success`. Mitigation: add a staleness guard — only report sessions where `lastActivityAt < (now - 30_000ms)`, treating very recent sessions as still-running.

### 5.3 MEDIUM: `scheduledTaskId` Field Is Undocumented

The `scheduledTaskId` field in session JSON files was found by direct inspection — it is not part of any public Claude Desktop API. It could be removed in future Claude Desktop versions. If removed, the fallback should be the D-01 original approach: correlate by `initialMessage` content containing `<scheduled-task name="<id>"` (also observed in actual data: `"<scheduled-task name=\"test-1\" ...>`"). Implement `scheduledTaskId` as primary, `initialMessage` parsing as fallback.

### 5.4 MEDIUM: Multiple orgId/userId Paths

Current machine has 1 orgId + 1 userId. The `skills-plugin` "org" has no `scheduled-tasks.json` — the glob will skip it naturally. However, if a user has multiple real orgIds (multiple Anthropic accounts), `setup()` must enumerate and ask which to track. The plugin should only monitor one `sessionsDir` (the one selected at setup time). If the user switches accounts, they re-run `setup`.

### 5.5 MEDIUM: crontab -l Returns Non-UTF8 or Has Unusual Encoding

On macOS, crontab entries are ASCII. The plugin should decode stdout as `utf-8` and handle any parse errors gracefully (skip malformed lines, log warning).

### 5.6 MEDIUM: wrapper.ts — Shell Quoting Edge Cases

The `harnesstune-wrap` bash script must correctly handle the case where `claude -p '...'` contains quotes inside the prompt. The wrapper captures stdout/stderr of the wrapped command. If the user's crontab entry uses double quotes around the prompt, the wrapper's `"$@"` pass-through handles this correctly. Single quotes in the prompt passed via crontab can break shell parsing — document in instructions that users should use double quotes for multi-word arguments in crontab.

### 5.7 MEDIUM: Run File Atomicity

The wrapper script writes a run file to `~/.harnesstune/cron-runs/`. If the collector reads a run file while the wrapper is still writing it (mid-JSON), `JSON.parse` will throw. Mitigation: the wrapper should write to a temp file (`<timestamp>.json.tmp`) and rename (atomic on same filesystem). The collector should ignore `.json.tmp` files.

### 5.8 LOW: crontab Disabled on Some macOS Configurations

macOS Ventura+ requires granting Full Disk Access to Terminal for `crontab` to work. If denied, `crontab -l` returns an error. The plugin should treat this gracefully: if `crontab -l` fails for any reason other than "no crontab," return `[]` from `discover()` and log a warning suggesting the user check permissions.

### 5.9 LOW: Run File Accumulation

If the collector is stopped for a long time, `~/.harnesstune/cron-runs/` could accumulate many run files. The `collectRuns()` implementation deletes processed files, but only after successful relay upload. If the relay is down and the retry queue is full (48-entry cap), older run files remain. Add a cleanup policy: scan for run files older than 7 days and delete them (matching the scheduler's 7-day backfill default from `scheduler.ts` line 64).

### 5.10 LOW: `--name` Flag Missing on Old Crontab Entries

If a user has old crontab entries calling `harnesstune-wrap` without `--name`, the parser must handle gracefully. The wrapper exits with a usage error (D-09), so no run file is written. But `discover()` will still see the crontab line and should either skip it or synthesize a name from the command. Decision: skip lines missing `--name` and emit a console.warn suggesting the user add `--name`.

---

## 6. Validation Architecture

### 6.1 Unit Tests to Write

**Claude Desktop — `mappers.ts`:**
- `mapScheduledTask(task)` → correct `AgentIdentity` fields including `status: 'paused'` for disabled tasks
- `mapSessionToRunReport(session, task)` → correct `durationMs`, `status: 'failure'` when `error` field present, `errorSummary` set from `error`
- `mapSessionToRunReport()` with no `error` → `status: 'success'`, no `errorSummary`

**Claude Desktop — `reader.ts`:**
- Filter: sessions with `scheduledTaskId` matching a known task → included
- Filter: sessions without `scheduledTaskId` → excluded (D-02)
- Filter: sessions with `lastActivityAt` newer than `since` → included; older → excluded
- Staleness guard: session with `lastActivityAt` within 30s of now → excluded (still running)

**Claude Code — `crontab.ts`:**
- Standard entry: `0 9 * * * harnesstune-wrap --name 'daily' claude -p 'test'` → parses to `{ schedule: '0 9 * * *', agentName: 'daily' }`
- Absolute path: `/Users/x/.harnesstune/bin/harnesstune-wrap --name 'x' ...` → detected
- `@reboot` entry: `@reboot harnesstune-wrap --name 'startup' ...` → `{ schedule: '@reboot', agentName: 'startup' }`
- Line without `--name` → skipped with warning
- Comment line `# 0 9 * * * harnesstune-wrap...` → skipped
- Exit code 1 from crontab → returns `[]`

**Claude Code — `mappers.ts`:**
- `mapCronRunFile(file)` → correct `RunReport` with all required fields
- `exitCode !== 0` → `status: 'failure'`
- `exitCode === 0` → `status: 'success'`

**Claude Code — `wrapper.ts`:**
- `generateWrapperScript()` → returns valid bash string containing `--name` parsing, temp file write, atomic rename
- Script includes `set -e` or proper error handling for the wrapped command

### 6.2 Integration Tests (Manual Verification Checkpoints)

1. **Claude Desktop detect():** Run `harnesstune-collector setup` on this machine → Claude Desktop shows as `[FOUND]`.

2. **Claude Desktop discover():** After setup, run one poll cycle → `scheduled-tasks.json` is read, `test-1` agent appears in relay at `GET /channels/:id/agents`.

3. **Claude Desktop collectRuns():** Force `since` to 7 days ago → all 39 historical scheduled sessions are mapped to `RunReport[]` and uploaded to relay.

4. **Claude Desktop error sessions:** The session `local_15cea2d0...` (rate limit error) appears in relay as `status: 'failure'` with `errorSummary: "You've hit your limit..."`.

5. **Claude Code setup():** Running `setup` with Claude Code enabled → `~/.harnesstune/bin/harnesstune-wrap` is created with mode `755`.

6. **Claude Code wrapper:** Execute `~/.harnesstune/bin/harnesstune-wrap --name 'test-run' echo hello` → a run file appears in `~/.harnesstune/cron-runs/`.

7. **Claude Code collectRuns():** After wrapper creates a run file, next poll cycle picks it up, maps it to `RunReport`, uploads it, and deletes the file.

8. **Claude Code discover():** Add a `harnesstune-wrap` entry to crontab → next `discover()` call returns the agent. Remove it → agent no longer discovered (agents are re-registered each cycle via scheduler).

9. **mtime guard:** Parse `scheduled-tasks.json` once; on next cycle with no changes → `stat()` shows same mtime → no re-parse (verify via logging).

10. **Build passes:** `tsc --build` from repo root succeeds with no errors after Phase 14 changes.

### 6.3 File Structure After Phase 14

```
packages/harnesstune-collector/src/plugins/
  interface.ts                   (unchanged)
  loader.ts                      (2 lines changed: pass config to Desktop+Code constructors)
  stubs/
    claude-desktop.ts            (upgraded from stub to full implementation)
    claude-code.ts               (upgraded from stub to full implementation)
    paperclip.ts                 (unchanged)
    openclaw.ts                  (unchanged)
  paperclip/
    client.ts                    (unchanged)
    mappers.ts                   (unchanged)
    types.ts                     (unchanged)
  claude-desktop/                (NEW)
    types.ts
    mappers.ts
    reader.ts
  claude-code/                   (NEW)
    types.ts
    mappers.ts
    wrapper.ts
    crontab.ts
```

### 6.4 The `harnesstune-wrap` Script Interface

```bash
#!/usr/bin/env bash
# harnesstune-wrap — capture exit code, duration, output tail for Claude Code cron jobs
# Usage: harnesstune-wrap --name <agent-name> <command> [args...]

set -euo pipefail
# ... parse --name from $@
# ... record startedAt
# ... run the wrapped command, capture stdout+stderr
# ... record finishedAt, exitCode
# ... write to ~/.harnesstune/cron-runs/<timestamp>-<name>.json.tmp
# ... rename to .json (atomic)
# ... exit with same exit code as wrapped command
```

**Run file schema (D-07):**
```json
{
  "agentName": "daily-report",
  "command": "claude -p 'Generate the daily report'",
  "exitCode": 0,
  "startedAt": "2026-04-23T09:00:01.000Z",
  "finishedAt": "2026-04-23T09:04:37.000Z",
  "durationMs": 276000,
  "outputTail": "last N lines of stdout+stderr"
}
```

The `agentName` in the run file maps to `RunReport.agentId`. The collector plugin uses `agentName` as the stable identifier (matching `AgentIdentity.agentId` built from crontab discovery).

**Output tail length:** Capture last 50 lines of stdout+stderr (Claude's discretion — reasonable default, no config needed for Phase 14).

**Run file cleanup policy:** Delete immediately after successful `RunReport` construction (before relay upload attempt). If relay upload fails, the retry queue handles retransmission — the run file itself is not needed after mapping.

---

## RESEARCH COMPLETE
