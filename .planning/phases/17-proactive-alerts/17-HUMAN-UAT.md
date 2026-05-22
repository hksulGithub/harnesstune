---
status: partial
phase: 17-proactive-alerts
source: [17-01-SUMMARY.md, 17-02-SUMMARY.md, 17-CONTEXT.md]
started: 2026-05-09T00:00:00.000Z
updated: 2026-05-09T03:45:00.000Z
---

## Current Test

[Tests 4/5/6 PASSED at runtime via direct AlertEngine driver. StatusBarManager badge rendering and alert-toast summary copy now have automated coverage. Tests 1/2/3 still require live VSCode interaction for actual status-bar/toast/panel behavior.]

## Tests

### 1. Stale-agent alert fires on missed cron window
expected: For an agent with `cron='*/5 * * * *'` whose `lastRunAt` is older than 2x the cron interval (>10 min), AlertEngine raises a `stale` alert on the next 60s evaluation cycle. Status bar shows `$(bell) 1` with amber background.
how: Pick a Claude Code Cron agent that runs every few minutes. Pause its cron entry (comment out the crontab line) for >2 cron periods. Confirm the bell appears in the status bar within ~60s of crossing the threshold.
result: **BLOCKED — requires live VSCode status bar.** A CLI session cannot observe the status-bar badge or its amber background.

  - **Stale-detection logic verified independently in Test 6 and regression-covered in `tests/alerts/AlertEngine.test.ts`.** With `*/5 * * * *` and stale `lastRunTs`, the engine now reports `threshold: 10m` in the reason while continuing to compare the underlying millisecond threshold.
  - **Status-bar wiring verified by source.** `extension.ts:355-360`: `alertEngine.onDidDetectAlerts((summary) => { activeAlertCount = Math.max(0, activeAlertCount + summary.problems.length - summary.recoveries.length); statusBarManager.setAlertCount(activeAlertCount); })`. `StatusBarManager.ts:18`: `setAlertCount(count)` updates `this.alertCount` and re-renders. `StatusBarManager.ts:41-44`: bell glyph appears when `this.alertCount > 0` (`text += ` $(bell) ${this.alertCount}`; hasIssue = true`); amber `statusBarItem.WarningBackground` follows from `hasIssue`.
  - **Automated status-bar coverage:** `tests/statusbar/StatusBarManager.test.ts` verifies `setAlertCount(3)` renders `$(bell) 3` and applies `statusBarItem.warningBackground`.
  - **Recommend:** human runs in a VSCode dev host with a paused cron agent and confirms the visual badge.

### 2. Failure-rate alert fires on threshold breach
expected: When an agent's recent run window crosses the configured failure-rate threshold, AlertEngine raises a `failure` alert. The toast notification batches multiple alerts in one cycle into a single `showWarningMessage` with a `View Fleet Dashboard` action.
how: Configure `alertConfig.failureRateThreshold = 0.5` on a workspace. Trigger 2 failing runs out of 3 on one of its agents. Confirm a warning toast appears within the next evaluation cycle, with the `View Fleet Dashboard` button.
result: **BLOCKED — requires live VSCode toast.** A CLI session cannot render `vscode.window.showWarningMessage`.

  - **Transition + batching logic verified in Test 5.** Driver run produced 2 problems in one `AlertCycleSummary` covering ws-local:stale + ws-remote:failing in a single fire of `onDidDetectAlerts`. The toast is built from one cycle's `summary.problems` (`extension.ts:362-372`) so 2 in-cycle alerts → 1 toast.
  - **Toast copy regression coverage:** `tests/alerts/alertNotifications.test.ts` verifies singular copy and one batched message for mixed failing/stale/degraded alert transitions.
  - **Toast wiring verified by source.** `extension.ts:362-378` calls `formatAlertWarningMessage(summary)`, then `vscode.window.showWarningMessage(`HarnessTune: ${msg}`, 'View Fleet Dashboard').then(action => { if (action === 'View Fleet Dashboard') { vscode.commands.executeCommand('harnesstune.showDashboard'); activeAlertCount = 0; statusBarManager.clearAlertBadge(); } })`. The `View Fleet Dashboard` button label and side-effect (open + clear) are explicit.
  - **Failing-state detection.** `AlertEngine.ts:76`: `const currentState: AlertState = isStale ? 'stale' : agentSummary.health` — `'failing'` health propagates straight through. The `failureThreshold` is enforced upstream by the provider's `health` computation (3+ consecutive failures → `'failing'`), not in the engine itself.
  - **Recommend:** human triggers 3 consecutive failures on a real agent and observes the toast in the dev host.

### 3. Status bar badge clears on dashboard open
expected: Clicking the status bar bell (or the `View Fleet Dashboard` toast button) opens the Dashboard panel AND clears the bell badge. The badge does not return until a new alert transition occurs.
how: With ≥1 active alert and bell visible, click the bell. Confirm Dashboard opens and bell disappears. Without resolving the underlying condition, wait one evaluation cycle. Bell should NOT come back (state already counted).
result: **BLOCKED — requires live VSCode webview interaction.**

  - **Badge-clearing logic verified by source.** Two paths both clear:
    1. **Toast click** — `extension.ts:374-376`: on `'View Fleet Dashboard'` action, sets `activeAlertCount = 0` and calls `statusBarManager.clearAlertBadge()`.
    2. **Direct dashboard command** — `extension.ts:604-605`: `harnesstune.showDashboard` registers handler that does `activeAlertCount = 0; statusBarManager.clearAlertBadge();` regardless of how it's invoked (status-bar click goes through the same command — see `StatusBarManager.ts:10`: `this.statusBarItem.command = 'harnesstune.showDashboard';`).
  - **Automated status-bar coverage:** `tests/statusbar/StatusBarManager.test.ts` verifies `clearAlertBadge()` removes the bell text and clears the warning background when no other issue is active.
  - **Dedup-on-revisit verified by source.** `AlertEngine.ts:94-116`: state transitions only fire when `currentState !== previousState`; the `stateMap` keyed on `${workspaceId}:${agentId}` persists across cycles. Once an agent is recorded as `'stale'`, subsequent evaluations with the same `'stale'` state skip the transition (no re-fire). So waiting one more cycle without resolving the condition will NOT increment the badge.
  - **Recommend:** human clicks the bell, confirms Dashboard opens + badge disappears, waits 60s, confirms no re-appearance.

### 4. AlertEngine respects `alertConfig.enabled = false`
expected: Workspaces with `alertConfig.enabled === false` are skipped during evaluation — no toasts, no badge increments, even if their agents are stale or failing.
how: Disable alerts on one workspace via the registry (`alertConfig.enabled = false`). Force a stale condition on one of its agents. Confirm no toast, no bell increment for that workspace. Then enable it; confirm alerts resume on next cycle.
result: **PASSED.** Verified at runtime via direct `AlertEngine` driver (esbuild bundle of `.uat-tmp/driver.ts` with `vscode` aliased to a stub `EventEmitter`).

  - **Source check:** `AlertEngine.ts:43-45`: ` const config = ws.alertConfig ?? ALERT_DEFAULTS; if (!config.enabled) { continue; } ` — workspaces with `enabled: false` short-circuit before any `getWorkspaceDetail` call.
  - **Runtime check:** Two workspaces, both with stale agents (`*/5 * * * *`, `lastRunAt = now - 60min` — well past 10-min threshold). ws-a has `alertConfig: { enabled: false }`, ws-b has `alertConfig: { enabled: true }`. Driver output:
    ```
    problems: 1, recoveries: 0
      problem: ws=ws-b agent=agent-b healthy->stale reason="No run in 1h (threshold: 10m)"
    expected: ws-a NOT in problems (disabled), ws-b IN problems (stale)
    got: ws-a in problems = false, ws-b in problems = true
    RESULT: PASS
    ```
  - The disabled workspace is fully invisible to the cycle even though its agent meets the staleness criteria — confirms the `continue` short-circuits before the agent loop.

### 5. Mixed local + remote evaluation
expected: AlertEngine's `compositeFleetProvider` evaluates BOTH local and remote workspaces in the same cycle. A failure on a remote agent and a staleness on a local agent in the same 60s window produce a single batched toast covering both.
how: Engineer a stale local agent and a failing remote agent simultaneously. Confirm one batched toast lists both alerts (or two separate toasts in the same cycle, per the implementation). Confirm bell count increments by exactly 2.
result: **PASSED.** Verified at runtime via direct `AlertEngine` driver.

  - **Source check:** `AlertEngine.ts:38-50` iterates `registry.getAll()` workspaces in order, calls `fleetProvider.getWorkspaceDetail(ws.id)` for each, and accumulates `problems`/`recoveries` into a single `AlertCycleSummary` fired once at the end of the cycle. The provider passed in is the composite (`extension.ts:351`) so local and remote workspaces share the same iteration.
  - **Runtime check:** Two workspaces, `ws-local` (mode='local', stale agent) + `ws-remote` (mode='remote', `health: 'failing'`). Driver output:
    ```
    problems: 2, recoveries: 0
      problem: ws=ws-local agent=local-agent healthy->stale reason="No run in 1h (threshold: 10m)"
      problem: ws=ws-remote agent=remote-agent healthy->failing reason="3+ consecutive failures"
    expected: 2 problems — ws-local:stale and ws-remote:failing in same cycle
    got: localStale=true, remoteFailing=true, total=2
    RESULT: PASS
    ```
  - Both transitions surfaced in a single `onDidDetectAlerts` fire — confirms the cycle accumulates across workspaces of different `mode` values into one summary, which `extension.ts:362-372` then renders as a single batched toast.

### 6. Cron-parser edge cases (v5 API)
expected: AlertEngine's `computeStaleThreshold()` correctly handles common cron expressions: `*/5 * * * *`, `0 * * * *`, `0 0 * * *`, `30 2 * * 1-5`. No crashes on weekday lists or step values.
how: Configure four agents with the four cron expressions above. Confirm staleness threshold for each is computed without errors (check logs for any cron-parser exceptions).
result: **PASSED.** Verified at runtime via direct `AlertEngine` driver.

  - **Source check:** `AlertEngine.ts:130-147` `computeStaleThreshold(schedule, multiplier)`: returns 24h fallback if `schedule` null/empty; else `CronExpressionParser.parse(schedule)`, takes two consecutive `next().toDate().getTime()` values, returns `(t2 - t1) * multiplier`. Wrapped in try/catch — any parse failure falls through to the 24h fallback.
  - **Runtime check (pass 1, recent agents):** Four agents on the four expressions, all with `lastRunAt = now - 1s`. `evaluate()` completed without exception (driver: `evaluate() completed without exception: true`). No `uncaughtException` or `unhandledRejection` listeners fired.
  - **Runtime check (pass 2, ancient agents):** Same expressions but `lastRunAt = now - 365d`. Driver output:
    ```
    stale-cycle problems: 4
      agent-0 -> stale reason="No run in 365d (threshold: 10m)"      // */5 → 10min
      agent-1 -> stale reason="No run in 365d (threshold: 2h)"       // 0 * * * * → 1h * 2
      agent-2 -> stale reason="No run in 365d (threshold: 48h)"      // 0 0 * * * → 24h * 2
      agent-3 -> stale reason="No run in 365d (threshold: 48h)"      // 30 2 * * 1-5 weekday list
    expected: 4 stale problems, no exceptions on any cron expression
    got: problems=4, allStale=true, threwError=false
    RESULT: PASS
    ```
  - All four expressions parsed cleanly — including the weekday list `30 2 * * 1-5`, which is the most likely candidate for parser fragility. Threshold values match the cron-parser v5 contract: `next2 - next1` for any anchor moment, multiplied by `staleMultiplier=2`.

## Summary

total: 6
passed: 3 (Tests 4, 5, 6)
blocked: 3 (Tests 1, 2, 3 — require live VSCode status bar / toast / panel; status-bar rendering and toast summary copy have automated unit coverage)
issues: 0
pending: 0
skipped: 0

## Gaps

- **Tests 1, 2, 3 require human in the VSCode dev host for actual VSCode surfaces.** Automated tests now cover `StatusBarManager` text/background rendering, badge clearing, and alert-toast summary copy, but a CLI session still cannot observe the real status-bar surface, the `showWarningMessage` toast, or the `View Fleet Dashboard` button click handler. Visual verification deferred to a human run with `code --extensionDevelopmentPath`.
- **Threshold display polish fixed after review.** Stale-alert reasons now format durations as minutes/hours/days, so a `*/5` schedule with multiplier 2 reports a `10m` threshold instead of `0h`.
- **No live cron pause exercised.** The driver synthesizes stale state via `lastRunAt = now - 60min`; we did not actually comment out a crontab line and wait. Equivalent in effect since the engine compares `Date.now() - lastRunTs` regardless of why `lastRunTs` is old.
