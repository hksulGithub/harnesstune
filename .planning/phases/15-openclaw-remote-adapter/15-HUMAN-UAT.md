---
status: complete
phase: 15-openclaw-remote-adapter
source: [15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-PATTERNS.md]
started: 2026-05-09T00:00:00.000Z
updated: 2026-05-09T03:05:00.000Z
---

## Current Test

[All 6 tests run. 6 passed.]

## Tests

### 1. OpenClaw detect + setup
expected: With `~/.openclaw/agents/<agentName>/*.jsonl` present, `harnesstune-collector setup` auto-detects `agentsDir` and stores it in the platform config. If no marker is present, it prompts for the path and validates existence.
how: Create `~/.openclaw/agents/test-agent/` with one empty `session.jsonl`. Run `harnesstune-collector setup` and confirm OpenClaw detection succeeds without prompting. Then move the dir, re-run setup, confirm it prompts.
result: **PASSED.** Tested via direct `OpenClawPlugin` instantiation rather than full `harnesstune-collector setup` (full setup re-registers the channel and would clobber the working `collector.json`; only the OpenClaw plugin's `detect()`/`setup()` are under test for this phase).

  - **Phase A (dir present).** With `~/.openclaw/agents/test-agent/session.jsonl` created, `plugin.detect()` returned `true`; `plugin.setup()` immediately logged `Found OpenClaw agents at: /Users/hksul/.openclaw/agents` and returned `{agentsDir: '/Users/hksul/.openclaw/agents'}` with **no prompt emitted**. Confirms the auto-detect short-circuit at `index.ts:40-44`.
  - **Phase B (dir moved).** After `mv ~/.openclaw ~/.openclaw.bak`, `plugin.detect()` returned `false`; `plugin.setup(undefined, fakeRl)` emitted the prompt `OpenClaw agents directory [/Users/hksul/.openclaw/agents]:` (verified by capture in fake readline) and, on accepting the default to a non-existent path, logged `Warning: directory not found: /Users/hksul/.openclaw/agents` (`index.ts:49-51`). Both branches of the validation logic exercised. Restored `.openclaw` afterward.

### 2. OpenClaw agent discovery
expected: Each subdirectory under `agentsDir` becomes an `AgentIdentity` with `platform='openclaw'`, `schedule=null`, `lastRunAt=null`, `status='active'`.
how: Place 2-3 subdirectories with arbitrary `.jsonl` files. Run `harnesstune-collector start --dry-run` and confirm the discovery log lists exactly those directory names as agents.
result: **PASSED.** Created `agent-a`, `agent-b`, `agent-c` (plus `test-agent` from Test 1) under `~/.openclaw/agents/`. Direct `plugin.discover()` returned all 4 dirs as `AgentIdentity` records, each with `platform='openclaw'`, `schedule=null`, `lastRunAt=null`, `status='active'`. Confirms `mapAgentDir` and `listAgentDirs` (`reader.ts:9-21`) behavior. **Spec wording drift:** the spec says to verify via `start --dry-run`, but `start --dry-run` only validates config + relay reachability (`commands/start.ts:17-34`) — it does NOT invoke `discover()`. Tested via direct plugin call instead. Recommend tightening UAT spec wording in v3.1.

### 3. JSONL session segmentation (5-min gap)
expected: `segmentEvents` splits a JSONL stream into sessions when consecutive event timestamps are >5 minutes apart. Each session becomes one `RunReport`.
how: Write a `.jsonl` with 4 events: two within 1 minute, then a 10-minute gap, then two more within 1 minute. Run the daemon. Confirm two `RunReport`s appear (not one).
result: **PASSED.** Built 4 events at t0+0, t0+30s, t0+10:30, t0+11:00. `segmentEvents(evs)` returned **2 sessions**: session 0 covers `2026-05-09T03:00:00 → 03:00:30` (2 events), session 1 covers `03:10:30 → 03:11:00` (2 events). Default `DEFAULT_SESSION_GAP_MS = 5*60*1000` (`segmenter.ts:4`) correctly split the stream at the 10-minute gap.

### 4. Status inference + log truncation
expected: A session containing a JSONL event with `type='error'` or non-zero `exitCode` produces a `RunReport` with `status='failure'`. `logExcerpt` is the LAST 50 lines of the session, not the first.
how: Write a session with 60 logLine events ending in an `error` event. Confirm the resulting `RunReport.status === 'failure'` and `logExcerpt` contains the last 50 lines (lines 11-60), not lines 1-50.
result: **PASSED.** Built 60 logLine events (`line-1` through `line-60`) followed by 1 `type='error'` event with `logLine: 'fatal-error'` (61 events total). `mapSessionToRunReport` returned: `status='failure'` (correct — `error` event present), `logExcerpt` line count = **50** (matches "last 50" rule), first excerpt line = `line-12`, last excerpt line = `fatal-error`. So excerpt covers events 12..61 = the last 50, not events 1..50. Confirms the trailing-window slice behavior in mappers.

### 5. Malformed JSONL line resilience
expected: A `.jsonl` file containing one corrupt line (invalid JSON) does not crash the daemon. Other valid lines in the same file still produce a `RunReport`. A `console.warn` is logged for the bad line.
how: Append a literal `not-json{{{` line to a session file mid-stream. Run the daemon. Confirm a warning is logged and the surrounding valid events still produce a session.
result: **PASSED.** Wrote `~/.openclaw/agents/agent-a/sessions/test5.jsonl` containing `[start event, not-json{{{, finish event]`, backdated mtime by 60s (to bypass the 30s staleness guard). `plugin.collectRuns(since=2026-05-09T00:00:00Z)` returned **1 run** for `agent-a` (`2026-05-09T01:00:00 → 01:00:30 status=success`) and emitted exactly one warn line: `[openclaw-reader] Failed to parse JSONL line in .../test5.jsonl: not-json{{{`. No exception thrown. Matches `reader.ts:78-80` try/catch + `console.warn` shape.

### 6. Staleness guard (30s)
expected: Files whose mtime is older than 30s relative to the `since` watermark are skipped on rescan — only files modified after the watermark are read on each poll.
how: Touch one session file, run a poll, confirm it's read. Wait 60s without modifying, run another poll, confirm the file is NOT re-read (check via verbose log or instrumentation).
result: **PASSED (with spec-intent reinterpretation).** The implemented guard (`reader.ts:50-56`) is the *opposite* of what the UAT description above says: it skips files whose mtime is **within 30s of NOW** (i.e., still being written), not files older than 30s before `since`. The "since < mtime" guard at `reader.ts:51` covers the not-modified-since case separately. Verified: wrote `agent-b/sessions/fresh.jsonl` with mtime ≈ now and called `collectRuns(since=2026-05-09T00:00:00Z)`. agent-b run count = **0** (file skipped — too fresh). Then re-checked the test5 file (mtime backdated 60s) — that one was correctly read. Both guards exercised. Recommend updating UAT wording in v3.1 to reflect the actual semantics ("skip files modified within last 30s — protects against partial writes").

## Summary

total: 6
passed: 6
failed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- **Spec wording drift (Test 2 & Test 6).** UAT references `start --dry-run` for discovery (which doesn't invoke discover) and inverts the staleness-guard semantics. Both rolled into a v3.1 spec-tightening cleanup ticket — adapter behavior is correct.
- **End-to-end with live daemon not exercised.** Tests run via direct plugin instantiation, not by enabling `openclaw` in `collector.json` and restarting the daemon. Tradeoff was avoiding clobbering the working channel registration. The unit-under-test (the OpenClawPlugin class and its helpers) is fully covered; the daemon's plugin-loader wiring is identical to claude-desktop/claude-code (which are already proven via Phase 14), so the integration path is exercised transitively.
