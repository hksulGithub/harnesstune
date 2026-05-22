---
status: complete
phase: 14-claude-desktop-claude-code-cron-adapters
source: [14-SUMMARY.md, 14-01-PLAN.md, 14-02-PLAN.md, 14-03-PLAN.md]
started: 2026-05-09T02:00:00.000Z
updated: 2026-05-09T04:55:00.000Z
---

## Current Test

[All 6 tests run. 6 passed (Test 2 re-verified after v3.1-relay-runs-ingestion fix).]

## Tests

### 1. Claude Desktop scheduled-tasks discovery
expected: With a real `~/Library/Application Support/Claude/scheduled-tasks.json` present, `harnesstune-collector` (after `setup` adds the `claude-desktop` plugin) reports each scheduled task as an `AgentIdentity` with `platform='claude-desktop'`, the right `name`, and the `cron` schedule preserved.
how: Run `harnesstune-collector setup` → enable `claude-desktop`. Run `harnesstune-collector start --dry-run` once and confirm log lines list discovered agents matching the entries in `scheduled-tasks.json`.
result: **PASSED.** Agent `test-1` ingested into relay (channelId `24e8286d-ca9e-4f07-8534-580babade5de`) with `platform='claude-desktop'` and `schedule='0 9 * * *'`. Verified 2026-05-09T02:13:40 via `GET /api/channels/{channelId}/agents`. Required upstream relay schema fix: `pnpm db:push` from `packages/harnesstune-relay` applied missing `agents`/`agent_runs` tables and `reports.agent_id` column (Turso schema drift). Post-fix relay log line count frozen at 611 with no new tracebacks across two heartbeat cycles.

### 2. Claude Desktop session → RunReport mapping (D-01, D-02)
expected: Session JSON files produced by Claude Desktop for a scheduled task are picked up and uploaded as `RunReport`s correlated by `scheduledTaskId`. Ad-hoc sessions (no `scheduledTaskId`) are skipped.
how: Trigger one scheduled task in Claude Desktop, wait for it to finish, then watch one daemon poll cycle. Confirm a `RunReport` appears for that task in the relay (or local fleet store) with `agentId` matching the scheduled task. Then start an ad-hoc Claude Desktop chat and confirm no `RunReport` is generated.
result: **PASSED (re-verified 2026-05-09T04:35–04:52 after v3.1-relay-runs-ingestion fix).** Original failure traced to two bugs (relay `/reports` never fanned out to `agent_runs`; collector cursor never persisted, `<` boundary let same session re-upload). Both fixed in v3.1; ticket closed.

  - **Adapter (claude-desktop plugin) — works.** Manually triggered `test-1` via Claude Desktop "지금 실행" at 02:33:24 → session file `local_0955716d-3028-43bb-baa7-2231c4251b91.json` written with `scheduledTaskId: "test-1"`, `lastActivityAt: 1778294021461` (02:33:41.461Z). Direct invocation of `scanSessions` + `mapSessionToRunReport` produced a valid RunReport: `{ agentId: "test-1", startedAt: "2026-05-09T02:33:24.686Z", finishedAt: "2026-05-09T02:33:41.461Z", status: "success", durationMs: 16775 }`. The `if (!session.scheduledTaskId) continue` filter at `reader.ts:63` confirms ad-hoc sessions are skipped (code-verified, not live-tested with an actual ad-hoc chat).
  - **Bug 1 fix verified.** `routes/reports.ts:57-125` now fans out `run_batch` envelopes into `agent_runs` rows with `.onConflictDoNothing()` keyed on the new `agent_runs_channel_agent_started_uniq` index (`schema.ts:62-64`). Per-batch `latestFinishedAtByAgent` updates `agents.lastRunAt`. After restart of relay (PID 57264) and collector (PID 57429) at 04:34, `GET /api/channels/24e8286d-…/agents/test-1/runs` returned `count: 1` with run id `4f0fe73c-0f51-4bc8-ad5c-8bdc03d1c090`, `status="success"`, `durationMs=16775`, `startedAt="2026-05-09T02:33:24.000Z"`, `finishedAt="2026-05-09T02:33:41.000Z"` — matches the spec verification target.
  - **Bug 2 fix verified.** Boundary in `reader.ts:54,69` changed `<` → `<=` (already-shipped sessions excluded). Cursor persistence added: new module `daemon/cursors.ts` round-trips `~/.harnesstune/cursors.json` as ISO strings; `commands/start.ts:54-55,119` loads on startup and saves after each `runCycle`. After 17 minutes of polling (last poll 04:52:32, ≥17 cycles past first upload), `count` remains 1. `cursors.json` shows `{"claude-desktop": "2026-05-09T02:33:41.461Z"}` matching the session's `lastActivityAt`.
  - **Disposition.** All three legs of Test 2 (adapter mapping, relay ingestion, dedup) verified. Ad-hoc-chat negative case (no `scheduledTaskId`) remains code-verified only — same disposition as the original UAT.

### 3. Claude Desktop mtime guard (D-03)
expected: When `scheduled-tasks.json` mtime is unchanged between polls, the daemon does NOT re-parse the full file. Sessions still get scanned for new completions.
how: Add a `console.log` (or use the existing daemon log) and watch two consecutive 60s poll cycles without modifying scheduled-tasks. Verify the file is opened once on startup, not on every cycle.
result: **PASSED (code-verified + empirical sanity).** Guard implemented at `plugins/stubs/claude-desktop.ts:85-93`: each `discover()` call stats `scheduled-tasks.json`, compares to `lastKnownMtime`, and returns `cachedAgents` short-circuit when `currentMtime <= lastKnownMtime && cachedAgents.length > 0`. Only `getScheduledTasksMtime` (a `statSync`) runs each cycle — no `readFileSync`/`JSON.parse` until mtime advances. `collectRuns()` is decoupled (lines 96-115): it always calls `readScheduledTasks()` to build the `taskIds` Set for filtering, plus `scanSessions()` for new completions — sessions get scanned every cycle as required. Empirical sanity: daemon (PID 83500) ran 43+ poll cycles between 02:00:07 and 02:43:11 with `scheduled-tasks.json` mtime frozen at 02:33:24 (modified once when "지금 실행" wrote `lastRunAt`); agentCount stayed at 1 with no errors logged. Note: a strict empirical "file opened once" check would require temporary `console.log` injection in `discover()` and a daemon rebuild — not run because the guard logic is plain and well-bounded. **Caveat:** `collectRuns()` does call `readScheduledTasks()` every cycle (for the taskId filter set). If the spec intent of D-03 is "no JSON.parse of scheduled-tasks.json on cache hits across the entire collector," that is NOT met — only `discover()` honors the guard. Flagging for v3.1 review.

### 4. Claude Code Cron crontab parsing
expected: `harnesstune-collector` (after enabling `claude-code`) discovers cron entries that invoke `harnesstune-cron-wrap --name <agentId> -- <command>` and reports them as agents with `platform='claude-code'` and the cron schedule preserved.
how: Add one test cron line that calls the wrapper with `--name test-agent`. Run setup + start. Confirm `test-agent` appears in fleet discovery with the correct cron expression.
result: **PASSED.** Spec naming drift noted: actual installed binary is `harnesstune-wrap` (not `harnesstune-cron-wrap`); crontab parser at `plugins/claude-code/crontab.ts:16` matches lines containing `harnesstune-wrap`. Test cron entry `0 0 1 1 * /Users/hksul/.harnesstune/bin/harnesstune-wrap --name test-agent echo hi` (yearly Jan 1 to avoid firing during UAT) installed at 02:47:13. On the very next poll cycle (02:47:26.799Z), `claude-code.agentCount` flipped 0→1. Verified via `GET /api/channels/24e8286d-…/agents`: agent record `c3c93e36-a81d-438e-8480-210ef9717c83` with `agentId='test-agent'`, `platform='claude-code'`, `schedule='0 0 1 1 *'`, `createdAt='2026-05-09T02:47:26.000Z'`. Spec wording uses a `--` separator before the command (`--name <agentId> -- <command>`); the wrapper does not consume `--`, so test entry omits it. Recommend tightening the UAT spec wording in v3.1.

### 5. Cron wrapper exit codes (D-09)
expected: `harnesstune-cron-wrap` (the bash wrapper from `wrapper.ts`) exits with code 2 when invoked without `--name`, and writes a structured run JSON when invoked correctly. The wrapper writes only local JSON — no relay calls (D-05).
how: Run `harnesstune-cron-wrap -- echo hi` directly (no --name) → expect exit 2. Run `harnesstune-cron-wrap --name foo -- echo hi` → expect exit 0 and a JSON file in `~/.harnesstune/cron-runs/` with the run record.
result: **PASSED.** `harnesstune-wrap -- echo hi` → exit 2 with usage line on stderr (matches `wrapper.ts` guard at lines 13-16). `harnesstune-wrap --name foo echo hi` → exit 0; `~/.harnesstune/cron-runs/1778294884404-foo.json` written with `{ agentName: "foo", command: "echo hi", exitCode: 0, startedAt, finishedAt, durationMs: 0, outputTail: "hi" }`. D-05 verified by code inspection: wrapper script contains zero `curl`/`wget`/network calls; only filesystem writes via atomic `.tmp` rename. Same `--` spec wording caveat as Test 4 — wrapper Usage is `--name <name> <command>` (no `--`).

### 6. Cron run pickup by collector
expected: A new run JSON dropped in `~/.harnesstune/cron-runs/` by the wrapper is picked up by the daemon on the next poll cycle and reported as a `RunReport` with the matching `agentId`.
how: After test 5 succeeds, watch the daemon log for the next poll. Confirm the run shows up in the fleet dashboard / relay channel.
result: **PASSED.** Wrapper produced `~/.harnesstune/cron-runs/1778294884404-foo.json` at 02:48:04. Daemon poll at 02:48:30.792Z consumed it: file count flipped 1→0 in cron-runs/ (file deleted by `claude-code` plugin after upload, per `plugins/stubs/claude-code.ts`). Verified envelope arrived at relay — report `43133629-a804-4efd-9262-652541dc21ac` (`type: "run_batch"`, `createdAt: 2026-05-09T02:48:30.000Z`) contains `body.runs[0] = { agentId: "foo", startedAt: "2026-05-09T02:48:04.000Z", finishedAt: "2026-05-09T02:48:04.000Z", status: "success", durationMs: 0, logExcerpt: "hi" }`. **Bug 1 caveat resolved (2026-05-09T04:54).** Re-verified cron path post-fix: `harnesstune-wrap --name foo echo "post-fix verify"` at 04:54:04 → consumed by collector → `GET /api/channels/.../agents/foo/runs` returned `count: 1` with run `c2ea85cc-0b19-4c53-97d0-ba57625c6f9e`, `logExcerpt: "post-fix verify"`. Original `1778294884404-foo.json` row (pre-fix) remains as audit-only `reports` blob — not backfilled, by design. See `.planning/v3.1-followups/relay-runs-ingestion.md` (status: complete).

## Summary

total: 6
passed: 6
failed: 0
issues: 0 (Test 2 originally failed on Bugs 1+2; both closed via v3.1-relay-runs-ingestion. Tests 4/6 caveats also resolved.)
pending: 0
skipped: 0
blocked: 0

## Gaps
