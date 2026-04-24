# Phase 17 Context: Proactive Alerts

> Decisions captured during discuss-phase. Guides research, planning, and execution.

## Prior Decisions Carried Forward

- **Phase 16 D-05**: FleetDataProvider abstraction (local + remote) — reuse for alert evaluation
- **Phase 16**: `computeHealth()` in LocalFleetProvider implements 3-consecutive-failure threshold
- **Phase 16**: `HealthState = 'healthy' | 'degraded' | 'failing' | 'no-data'` type exists
- **Phase 2**: NotificationService handles real-time agent errors via `vscode.window.showErrorMessage`
- **Phase 8**: `AgentIdentity.schedule` stores cron expression (string | null)
- **Phase 9**: Per-workspace SecretStore pattern for token storage

## Decisions

### D-01: Alert Engine Architecture — Extension-Side Polling

A new `AlertEngine` class polls `FleetDataProvider` on a 60-second timer for all registered workspaces (local and remote). No separate background process, no relay push — pure extension-side evaluation.

- Reuses `computeHealth()` for failure detection (3-consecutive-failure threshold already implemented)
- Evaluates remote workspaces via existing `FleetDataProvider.getWorkspaceSummaries()` — no new relay endpoints
- Starts on extension activation, disposes on deactivation

**Why:** Keeps Phase 17 scope tight. FleetDataProvider already abstracts local vs remote data access. No relay API changes needed.

### D-02: Stale Detection — 2x Cron Interval from lastRunAt

Parse `AgentIdentity.schedule` with `cron-parser`, compute the interval between runs, and flag as stale if `now - lastRunAt > 2 * interval`.

- Falls back to 24-hour default if `schedule` is null or unparseable
- Uses `lastRunAt` from agent summary data (available via FleetDataProvider)
- Matches ALRT-01 spec exactly

**Why:** Adaptive to agent frequency — a 6-hour agent gets a 12-hour stale window, an hourly agent gets 2 hours. Fixed thresholds don't capture this.

### D-03: State Deduplication — In-Memory Transition Map

AlertEngine maintains `Map<string, HealthState>` keyed by `workspaceId:agentId`. Notifications only fire on state transitions (e.g., healthy→failing, healthy→stale). Map resets on extension restart.

- Prevents notification spam (no re-firing every 60s for the same issue)
- State transitions tracked: healthy→stale, healthy→failing, healthy→degraded, stale→failing, any→healthy (recovery, logged but not toasted)
- Extension restart = fresh evaluation = will re-alert for ongoing issues (acceptable)

**Why:** In-memory is sufficient. Persisting to globalState adds complexity for minimal benefit — if the extension restarts, re-alerting for ongoing issues is actually desirable.

### D-04: Notification Delivery — Toast + Status Bar Badge

New alerts trigger `vscode.window.showWarningMessage` with a single summary toast per evaluation cycle, batched across all workspaces:

- Format: `"3 agents need attention: 2 failing, 1 stale"`
- Toast action: "View Fleet Dashboard" → opens dashboard to fleet overview
- Status bar: unread alert count badge via existing `StatusBarManager` pattern
- Badge clears when user opens fleet dashboard

**Why:** Single summary toast prevents notification fatigue. Status bar badge provides persistent visibility without interruption. Reuses existing StatusBarManager infrastructure.

### D-05: Alert Configuration — WorkspaceRecord.alertConfig

Add optional `alertConfig` field to `WorkspaceRecord`:

```typescript
interface AlertConfig {
  enabled: boolean;        // default: true
  failureThreshold?: number; // default: 3 (consecutive failures)
  staleMultiplier?: number;  // default: 2 (2x cron interval)
}
```

- Stored in registry (globalState) alongside existing workspace data
- AlertEngine reads config from registry before evaluating each workspace
- Defaults applied when `alertConfig` is undefined (all workspaces alert-enabled by default)

**Why:** No new storage mechanism. WorkspaceRecord already holds per-workspace config. Simple shape covers ALRT-04 requirements.

### D-06: Quiet Hours — Deferred

Quiet hours (time-based notification suppression) deferred to a future milestone. Not in Phase 17 scope.

**Why:** Simplifies Phase 17. Core alert functionality ships without suppression complexity. Can be added later as a global extension setting.

### D-07: Relay Alert State — Extension-Only (ALRT-05 Stub)

No relay-side alert persistence or digest endpoints. AlertEngine evaluates remote workspaces by polling relay via existing FleetDataProvider (which calls `getSummary()`, `getRuns()`, `getAgents()`). Alert state lives entirely in extension memory.

**Why:** Avoids relay API + DB schema changes. Extension-side evaluation covers the requirement — user sees alerts for remote workspaces when VS Code is open. Server-side alerting (email/Slack digest when editor is closed) is a natural future milestone feature.

## Deferred Ideas

- Quiet hours (time-based suppression) — global extension setting, future milestone
- Relay-side alert persistence + digest endpoint — enables alerts when editor is closed
- Email/Slack alert forwarding via relay
- Per-workspace quiet hours (vs global)
- Alert history view in dashboard

## Requirements Coverage

| Requirement | Decision | Coverage |
|-------------|----------|----------|
| ALRT-01: Stale agent detection | D-02 | Full — 2x cron interval with 24h fallback |
| ALRT-02: Failure rate threshold | D-01 | Full — reuses computeHealth() 3-consecutive threshold |
| ALRT-03: VS Code notifications | D-04 | Full — toast + badge + dashboard action |
| ALRT-04: Per-workspace config | D-05 | Partial — enable/disable + thresholds, quiet hours deferred |
| ALRT-05: Relay digest | D-07 | Stub — extension-side evaluation only, no relay changes |
