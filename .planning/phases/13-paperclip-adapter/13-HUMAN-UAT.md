---
status: passed
phase: 13-paperclip-adapter
source: [13-VERIFICATION.md]
started: 2026-04-23T07:00:00.000Z
updated: 2026-05-09T04:30:00.000Z
followup: v3.1-paperclip-shape-rewrite — closed (rewrite complete, UAT re-run green)
---

## Current Test

[complete — all tests passing after v3.1 shape rewrite]

## Tests

### 1. API response shape validation
expected: Actual Paperclip API responses match the rewritten type interfaces (PaperclipAgent, PaperclipHeartbeatRun, PaperclipCostEntry, PaperclipActivity)
result: **PASSED (re-run 2026-05-09 against http://localhost:3100 via SSH tunnel).** All four interfaces now match real shapes. Driver pulled: 1 company, 4 agents, 1131 heartbeat-runs (7-day window for first agent), 4 cost rows, 86 activity entries. Field validation on first item of each response set returned zero missing keys for the expected field sets (`agent: id/companyId/name/status/lastHeartbeatAt/runtimeConfig/adapterType`; `heartbeat-run: id/agentId/startedAt/finishedAt/status/usageJson/stdoutExcerpt/errorCode`; `cost: agentId/agentName/costCents/inputTokens/outputTokens/apiRunCount`; `activity: id/action/createdAt/agentId/details`).

### 2. Pagination cursor behavior
expected: getAll<T> cursor-based pagination works against real Paperclip API
result: **PASSED.** All five list endpoints returned raw arrays (no envelope) and the adaptive `getAll<T>` consumed them without throwing. Envelope path remains code-verified but untriggered (no envelope-mode deployment available to exercise it). Adaptive handler is the v3.0 win that this re-run confirms still holds.

### 3. Cost from usageJson on each run (replaces enrichWithCosts)
expected: `mapHeartbeatRun` produces `costCents` from `usageJson.costUsd` (rounded ×100)
result: **PASSED.** Real run sample: `costUsd=0.19958114999999996 → costCents=20`. Per v3.1 decision, `enrichWithCosts` was removed entirely; per-run cost now comes from each `PaperclipHeartbeatRun.usageJson.costUsd`. The aggregated `getCostsByAgent` method is retained on the client for other potential uses but is no longer called in `collectRuns`.

### 4. Activity endpoint format + field-rename mapping
expected: Activity returns `action`/`createdAt`/`details` and `mapActivitiesToEvents` produces RunReport-shaped events
result: **PASSED.** Sample mapped event: `action="issue.comment_added" → logExcerpt="[issue.comment_added] {"updated":true,"commentId":"b0205ec8-..."}"`. `startedAt === finishedAt === activity.createdAt`, `agentId` carried through. Field renames applied at the type and mapper level; old `eventType`/`occurredAt`/`detail` fully removed.

### 5. Setup credential validation
expected: setup() prompts for serverUrl + apiKey, validates via getCompanies(), auto-selects or prompts for companyId
result: **PASSED (carried from prior run).** Wizard run on 2026-05-09 — serverUrl + apiKey accepted, getCompanies() returned 1 company, auto-selected companyId, token issued, config written to `~/.harnesstune/collector.json` with chmod 600. Fixed two upstream bugs: shared-readline injection across plugins, adaptive raw-array handling in `getAll<T>`. Both fixes survive the v3.1 rewrite.

### Bonus B1: mapAgent end-to-end
result: **PASSED.** Identity for "CEO" agent: `schedule="*/60 * * * *"` (derived from `runtimeConfig.heartbeat.intervalSec=3600`), `lastRunAt` carried from `lastHeartbeatAt`, `platform="paperclip"`, `status="idle"`.

### Bonus B2: mapHeartbeatRun status translation
result: **PASSED.** 1131 runs translated: succeeded→success (980), failed→failure (151), running→running (0). All counts matched on both sides of the mapping.

## Summary

total: 7 (5 main + 2 bonus)
passed: 7
failed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- Cursor envelope path in `getAll<T>` remains untriggered (no deployment uses it). Acceptable — adaptive handler degrades gracefully.
- `getTaskDefinitions` is implemented but not consumed in `collectRuns`. Available for future features needing task-definition metadata.

## Disposition

Phase 13 is fully shipped in v3.1. Collector now produces valid RunReports against the real Paperclip API. Followup ticket `v3.1-paperclip-shape-rewrite` is closed.

Followup ticket: `.planning/v3.1-followups/paperclip-shape-rewrite.md` (status: complete)
