---
status: partial
phase: 16-fleet-dashboard-historical-reporting-ui
source: [16-CONTEXT.md, 16-UI-SPEC.md, 16-01-PLAN.md, 16-02-PLAN.md]
started: 2026-05-09T00:00:00.000Z
updated: 2026-05-09T03:30:00.000Z
---

## Current Test

[Test 4 PASSED at code+runtime level. Test 5 local-path PASSED and remote path unblocked by v3.1 relay ingestion. Automated coverage now verifies dashboard request/navigation helpers, mixed workspace cards, relay-unreachable copy, date range selected state, empty workspace state, and run-history controls. Remaining blocked checks require live VSCode webview clicking/visual inspection.]

## Tests

### 1. Fleet overview renders mixed local + remote workspaces
expected: With at least one local workspace (any local Claude Code/OpenClaw collector data) AND one remote workspace (relay-connected) configured, opening the Dashboard panel shows both as fleet cards with correct counts (active/stale/failing).
how: Configure 1 local workspace via `harnesstune-collector setup` and 1 remote workspace via `Connect to Remote…` in VSCode. Open the Dashboard panel. Confirm both cards appear and the counts match what's actually in the data.
result: **BLOCKED — requires live VSCode webview interaction.** A CLI session cannot drive the Dashboard webview, click cards, or visually verify rendered counts.

  - **Code-level evidence the wiring exists:** `src/panels/DashboardPanel.ts` (181 LOC) instantiates both `LocalFleetProvider` and `RemoteFleetProvider` (verified against `src/providers/`); `src/webview/dashboard/App.tsx:51-74` posts `fleet:requestOverview` on mount; the host responds with merged summaries from both providers. `FleetOverview.tsx:46-50` renders `summaries.length` workspaces card-by-card with `HealthDot` per workspace.
  - **Automated render coverage:** `tests/webview/dashboardComponents.test.tsx` renders mixed local + remote summaries and asserts both workspace names plus the relay-unreachable treatment render in the overview.
  - **Provider correctness verified independently** in Test 4 (LocalFleetProvider) and Phase 14 Test 1 (RemoteFleetProvider's `getSummary` against the live relay returned the test-1 channel agent listing). The two pieces hook into the same `FleetDataProvider` interface.
  - **Recommend:** human runs `code --new-window` against the workspace, opens the Dashboard panel, and visually confirms.

### 2. Drill-down navigation: Fleet → Workspace → Agent (D-03)
expected: Clicking a workspace card replaces the fleet view with that workspace's agent list. Clicking an agent replaces with agent detail (FDSH-03 run history table). Breadcrumb at the top reads `Fleet > <Workspace> > <Agent>` and each crumb is clickable to jump back.
how: From fleet overview, click any workspace card. Confirm view changes to agent list. Click any agent. Confirm view changes to detail with run history. Click the `Fleet` breadcrumb. Confirm return to overview.
result: **BLOCKED — requires live VSCode webview interaction.**

  - **Code-level evidence:** `App.tsx:11` defines `ViewLevel = 'fleet' | 'workspace' | 'agent'`; `App.tsx:105-129` implements `handleSelectWorkspace`, `handleSelectAgent`, `handleNavigateFleet`, `handleNavigateWorkspace` — all four navigation transitions wired. `BreadcrumbBar.tsx` is mounted unconditionally at line 134 and receives `onNavigateFleet`/`onNavigateWorkspace` callbacks. State persists across view changes via `vscode.setState({ nav, days })` at `App.tsx:46-48`.
  - **Automated logic coverage:** `tests/webview/dashboardState.test.ts` verifies workspace selection, agent selection, fleet breadcrumb navigation, workspace breadcrumb navigation, and host request creation for all three view levels.
  - The state machine is plain and well-bounded — but actual click handling, focus, and view-replacement rendering need human verification in the webview.

### 3. Date range persistence across drill-down (D-04)
expected: Selecting `7d` at fleet level persists when drilling into a workspace and again into an agent. Changing it at agent detail propagates back up when navigating to fleet.
how: Set range to `7d` at fleet view. Drill to workspace, then agent — confirm `7d` still selected. Change to `30d` at agent detail. Navigate back to fleet — confirm `30d` shown.
result: **BLOCKED — requires live VSCode webview interaction.**

  - **Code-level evidence:** `App.tsx:38` holds `days` in a single `useState` at the App component level (not scoped to a child); `<DateRangeSelector selected={days} onSelect={setDays} />` at line 133 shares the same setter regardless of `nav.level`. `App.tsx:51-74` re-fires the data request whenever `days` changes (deps array includes `days`). `App.tsx:46-48` persists `{ nav, days }` to VSCode webview state on every change, so selection survives panel close/reopen.
  - **Automated render coverage:** `tests/webview/dashboardComponents.test.tsx` renders `DateRangeSelector` with `selected={30}` and asserts the active tab state plus the other ranges are present.
  - **Automated logic coverage:** `tests/webview/dashboardState.test.ts` verifies restored persisted `{ nav, days }` state and confirms each host request carries the active `days` value.
  - The architecture trivially satisfies "persist across drill-down" because `days` lives one level above the view-level state. Visual verification is the remaining gap.

### 4. Local data via direct file read (D-06)
expected: `LocalFleetProvider` reads `~/.harnesstune/cron-runs/*.json` directly without requiring a running collector daemon HTTP endpoint. The dashboard can render local fleet data even when the daemon is stopped.
how: With local cron run files present, stop the daemon (`harnesstune-collector stop`). Open the Dashboard. Confirm local workspace cards still render correct historical counts.
result: **PASSED.** Verified at runtime via direct provider instantiation (esbuild-bundled test driver, daemon untouched).

  - **Source check:** `src/providers/LocalFleetProvider.ts:49` sets `this.cronRunsDir = path.join(os.homedir(), '.harnesstune/cron-runs/')`. `readCronRunFiles` (lines 52-82) uses `fs.promises.readdir` + `fs.promises.readFile` directly — zero `fetch`, `http`, or relay-client imports. No daemon HTTP dependency exists in the call graph.
  - **Runtime check (daemon was running but provider never contacted it):** Seeded `~/.harnesstune/cron-runs/` with 5 fixture files (4 for `agent-x`: 3 success + 1 failure most-recent; 1 for `agent-y`: 1 success). Bundled `LocalFleetProvider` via esbuild with a stub `IWorkspaceRegistry` (`getAll()` returns `{id:'ws-local'}`). `getWorkspaceSummaries(7)` returned `{agentCount: 2, errorRatePct: 20, health: 'degraded', lastActivityTs: 1778293690602}` — exactly matches the fixture (1 fail / 5 runs = 20%). `getWorkspaceDetail` correctly grouped by agent (agent-x: degraded/75% success; agent-y: healthy/100%). Then re-ran with empty `cron-runs/` → returned `health: 'no-data'`, `agentCount: 0`. Both populated and empty paths exercised without invoking the daemon.

### 5. Agent detail run history (FDSH-03)
expected: Agent detail view shows a run history table with `startedAt`, `status`, `durationMs`, `costCents`, sorted descending by `startedAt`. Selecting a row opens or expands log/error detail for that run.
how: Pick any agent with ≥3 historical runs. Confirm rows are sorted newest-first. Click any row and confirm details (logExcerpt or errorSummary) become visible.
result: **PARTIAL — local path PASSED; remote path unblocked by v3.1 relay ingestion fix and needs UI re-test.**

  - **Local path (LocalFleetProvider).** `getAgentDetail('ws-local', 'agent-x', 7)` against the same fixture returned **4 `FleetRunRecord`s**, sorted newest-first (timestamps 1778293690502, 1778288290502, 1778281090502, 1778273890502 — strict descending). Each record carried `runId`, `timestampTs`, `durationMs: 100`, `status` (`'failing'` for the failed run, `'healthy'` for the others), `costUsd: 0` (local provider has no cost data), `logText` (the `outputTail` from the run file). Sort assertion `every((r,i,arr) => i===0 || arr[i-1].timestampTs >= r.timestampTs)` returned `true`. Row-expansion UI itself (`RunLogExpander.tsx`) is wired to `logText` per inspection but needs UI test.
  - **Remote path (RemoteFleetProvider).** Unblocked after review: `v3.1-relay-runs-ingestion` is complete, and `POST /reports` now fans out `run_batch` envelopes into `agent_runs`; `RemoteFleetProvider.getAgentDetail` still calls `relayClient.getRuns(agentId)` against `/api/channels/{cid}/agents/{agentId}/runs`, which is now populated by collector uploads. Remaining gap is visual/webview verification of the rendered remote run-history table.
  - **Automated render coverage:** `tests/webview/dashboardComponents.test.tsx` renders `AgentDetail` with two run rows and asserts table headers, cost cells, and expandable log controls are present.
  - **Disposition.** Local-path implementation is correct end-to-end. Remote-path client and relay ingestion path are now code-complete; re-test in the VSCode webview against a relay-backed workspace with uploaded runs.

### 6. Empty state + error state
expected: When a workspace has zero agents in the selected window, the agent list shows a clear empty state (not a blank page or a crash). When the relay returns an error for a remote workspace, the workspace card shows an error indicator instead of bogus zero counts.
how: Set range to `24h` for a workspace with no recent activity → confirm empty state. Disconnect the relay (kill network briefly) and refresh dashboard → confirm error state on the remote card.
result: **BLOCKED on UI verification — code-level evidence shows both states implemented. Relay-unreachable fidelity gap fixed in code.**

  - **Empty state.** `FleetOverview.tsx:46-50` renders `<div className="fleet-empty">` with the copy "No workspaces connected / Add a workspace to start monitoring your agent fleet." when `summaries.length === 0`. Also confirmed at provider level in Test 4: empty `cron-runs/` returned `health: 'no-data'`, `agentCount: 0` cleanly.
  - **Error state (relay disconnect).** Fixed after review: `RemoteFleetProvider` now catches `getSummary()` failures and pushes a summary with `health: 'unreachable'` rather than `health: 'no-data'`. `HealthDot` labels this state as "Unreachable", `fleet.css` renders it as a square error marker, and `FleetOverview` shows explicit "Relay unreachable" text on the card. This keeps unreachable remote workspaces visible without conflating relay failure with a reachable-but-empty workspace.
  - **Automated render coverage:** `tests/webview/dashboardComponents.test.tsx` verifies the empty workspace drill-down copy and the unreachable overview card copy/class render from server-side React rendering.

## Summary

total: 6
passed: 1 (Test 4)
partial: 1 (Test 5 — local path PASSED, remote path code-complete, render coverage added, awaiting live UI re-test)
blocked: 4 (Tests 1, 2, 3, 6 — require live VSCode webview interaction; navigation/request/static rendering has automated coverage)
issues: 0
pending: 0
skipped: 0

## Gaps

- **Tests 1, 2, 3, 6 require human in the VSCode webview for interaction/visual verification.** Automated component-render and state-helper tests now cover the main static states, navigation transitions, and host request payloads, but a CLI session still cannot click cards or inspect VSCode webview pixels. Visual verification deferred to a human run with `code --new-window`.
- **Test 5 remote path needs live re-test.** `v3.1-relay-runs-ingestion` is fixed; verify `getRuns(agentId)` records render in the agent detail table for a relay-backed workspace.
- **Test 6 visual verification still needed.** Code now distinguishes relay-unreachable from no-data, but a human still needs to verify the rendered card in the VSCode webview.
- **No live daemon stoppage exercised.** Test 4 ran with the daemon running because stopping it would invalidate Phase 14 cron-pickup tests. Provider-level verification (zero HTTP calls in the call graph) is sufficient to satisfy D-06's contract; the daemon-stopped path is structurally identical.
