---
phase: 17
plan: 1
title: AlertEngine + types + stale/failure detection logic
wave: 1
depends_on: []
requirements: [ALRT-01, ALRT-02]
files_modified:
  - src/types/alerts.ts
  - src/types/workspace.ts
  - src/alerts/AlertEngine.ts
  - package.json
autonomous: true
---

# Plan 1: AlertEngine + Types + Stale/Failure Detection Logic

## Goal

Create the AlertEngine class that polls FleetDataProvider every 60 seconds, detects stale agents (2x cron interval) and failing agents (3 consecutive failures), and tracks state transitions in an in-memory Map to prevent duplicate notifications. This plan delivers the core detection logic; notification delivery is Plan 02.

## must_haves

- AlertConfig type definition exists
- AlertEngine class exists with 60s polling interval
- Stale detection uses cron-parser to compute 2x interval, 24h fallback
- State transition map prevents duplicate alerts
- AlertEngine emits an event with transition details for Plan 02 to consume
- cron-parser added as a dependency

## Tasks

<task id="1">
<title>Define alert types and extend WorkspaceRecord with alertConfig</title>
<read_first>
- src/types/workspace.ts (WorkspaceRecord, IWorkspaceRegistry — current shape)
- src/types/fleet.ts (HealthState type)
</read_first>
<action>

**1a. Create `src/types/alerts.ts`:**

```typescript
import type { HealthState } from './fleet.js';

/** Per-workspace alert configuration stored on WorkspaceRecord */
export interface AlertConfig {
  enabled: boolean;           // default: true
  failureThreshold?: number;  // default: 3 (consecutive failures)
  staleMultiplier?: number;   // default: 2 (2x cron interval)
}

/** Extended health state that includes 'stale' (not in HealthState) */
export type AlertState = HealthState | 'stale';

/** Fired when an agent transitions between alert states */
export interface AlertTransition {
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
  previousState: AlertState;
  currentState: AlertState;
  /** ISO 8601 timestamp of the agent's last run, null if never */
  lastRunAt: string | null;
  /** Human-readable reason for the alert */
  reason: string;
}

/** Summary of all transitions in a single evaluation cycle */
export interface AlertCycleSummary {
  /** Transitions that represent new problems (healthy -> failing/stale/degraded) */
  problems: AlertTransition[];
  /** Transitions that represent recoveries (failing/stale -> healthy) */
  recoveries: AlertTransition[];
}

/** Default alert configuration values */
export const ALERT_DEFAULTS = {
  enabled: true,
  failureThreshold: 3,
  staleMultiplier: 2,
  staleFallbackMs: 24 * 60 * 60 * 1000, // 24 hours
  pollIntervalMs: 60_000, // 60 seconds
} as const;
```

**1b. Add `alertConfig` field to `WorkspaceRecord` in `src/types/workspace.ts`:**

Add the following import at the top of the file:

```typescript
import type { AlertConfig } from './alerts.js';
```

Add the following field to the `WorkspaceRecord` interface, after the `agents` field:

```typescript
  /** Per-workspace alert configuration (defaults applied when undefined) */
  alertConfig?: AlertConfig;
```

Add `'alertConfig'` to the `update()` method's `Pick` type on `IWorkspaceRegistry`:

In the existing line:
```typescript
update(id: string, changes: Partial<Pick<WorkspaceRecord, 'name' | 'status' | ... | 'agents'>>): Promise<void>;
```

Add `| 'alertConfig'` before the closing `>>`.

</action>
<acceptance_criteria>
- src/types/alerts.ts exists and exports `AlertConfig`, `AlertState`, `AlertTransition`, `AlertCycleSummary`, `ALERT_DEFAULTS`
- src/types/workspace.ts contains `import type { AlertConfig } from './alerts.js'`
- WorkspaceRecord contains `alertConfig?: AlertConfig`
- IWorkspaceRegistry.update() Pick type includes `'alertConfig'`
</acceptance_criteria>
</task>

<task id="2">
<title>Create AlertEngine with stale/failure detection and state transition tracking</title>
<read_first>
- src/types/alerts.ts (types from Task 1)
- src/types/fleet.ts (HealthState, FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentSummary)
- src/providers/FleetDataProvider.ts (FleetDataProvider interface)
- src/providers/LocalFleetProvider.ts (computeHealth pattern, constructor pattern)
- src/types/workspace.ts (WorkspaceRecord, IWorkspaceRegistry, AgentIdentity)
- src/notifications/NotificationService.ts (Disposable pattern)
</read_first>
<action>

**Create `src/alerts/AlertEngine.ts`:**

```typescript
import * as vscode from 'vscode';
import { parseExpression } from 'cron-parser';
import type { FleetDataProvider } from '../providers/FleetDataProvider.js';
import type { IWorkspaceRegistry } from '../types/workspace.js';
import type { HealthState } from '../types/fleet.js';
import type {
  AlertState,
  AlertTransition,
  AlertCycleSummary,
  AlertConfig,
} from '../types/alerts.js';
import { ALERT_DEFAULTS } from '../types/alerts.js';

export class AlertEngine implements vscode.Disposable {
  private readonly _onDidDetectAlerts = new vscode.EventEmitter<AlertCycleSummary>();
  public readonly onDidDetectAlerts = this._onDidDetectAlerts.event;

  /** In-memory state map: key = "workspaceId:agentId", value = last known AlertState */
  private readonly stateMap = new Map<string, AlertState>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly fleetProvider: FleetDataProvider,
    private readonly registry: IWorkspaceRegistry,
  ) {}

  /** Start the polling loop */
  public start(): void {
    if (this.timer) { return; } // idempotent
    // Run first evaluation immediately, then every 60s
    void this.evaluate();
    this.timer = setInterval(() => void this.evaluate(), ALERT_DEFAULTS.pollIntervalMs);
  }

  /** Run a single evaluation cycle across all workspaces */
  private async evaluate(): Promise<void> {
    const workspaces = this.registry.getAll();
    const problems: AlertTransition[] = [];
    const recoveries: AlertTransition[] = [];

    for (const ws of workspaces) {
      const config = ws.alertConfig ?? {
        enabled: ALERT_DEFAULTS.enabled,
        failureThreshold: ALERT_DEFAULTS.failureThreshold,
        staleMultiplier: ALERT_DEFAULTS.staleMultiplier,
      };
      if (!config.enabled) { continue; }

      let detail;
      try {
        detail = await this.fleetProvider.getWorkspaceDetail(ws.id, 7);
      } catch {
        continue; // skip workspaces we can't reach
      }

      // Use agents from FleetWorkspaceDetail for health, and
      // agents from WorkspaceRecord for schedule info (cron expression)
      for (const agentSummary of detail.agents) {
        const key = `${ws.id}:${agentSummary.id}`;
        const previousState: AlertState = this.stateMap.get(key) ?? 'healthy';

        // Determine current state: check stale first, then health
        let currentState: AlertState;
        let reason: string;

        // Find matching AgentIdentity from registry for schedule info
        const identity = ws.agents.find(
          a => a.agentId === agentSummary.id || a.id === agentSummary.id
        );
        const schedule = identity?.schedule ?? null;
        const lastRunAt = identity?.lastRunAt ?? null;
        const lastRunTs = agentSummary.lastRunTs;

        // Check staleness first
        const staleThresholdMs = this.computeStaleThreshold(
          schedule,
          config.staleMultiplier ?? ALERT_DEFAULTS.staleMultiplier,
        );
        const isStale = lastRunTs > 0 && (Date.now() - lastRunTs > staleThresholdMs);

        if (isStale) {
          currentState = 'stale';
          const hoursAgo = Math.round((Date.now() - lastRunTs) / 3600000);
          reason = `No run in ${hoursAgo}h (threshold: ${Math.round(staleThresholdMs / 3600000)}h)`;
        } else {
          // Use health from FleetAgentSummary
          currentState = agentSummary.health;
          reason = currentState === 'failing'
            ? `${config.failureThreshold ?? ALERT_DEFAULTS.failureThreshold}+ consecutive failures`
            : currentState === 'degraded'
              ? 'Recent failures detected'
              : '';
        }

        // Only fire on state transitions
        if (currentState !== previousState) {
          this.stateMap.set(key, currentState);

          const transition: AlertTransition = {
            workspaceId: ws.id,
            workspaceName: ws.name,
            agentId: agentSummary.id,
            agentName: agentSummary.name,
            previousState,
            currentState,
            lastRunAt,
            reason,
          };

          if (currentState === 'healthy' || currentState === 'no-data') {
            recoveries.push(transition);
          } else {
            problems.push(transition);
          }
        } else {
          // No transition — ensure state is tracked
          this.stateMap.set(key, currentState);
        }
      }
    }

    // Only fire event if there are actual transitions
    if (problems.length > 0 || recoveries.length > 0) {
      this._onDidDetectAlerts.fire({ problems, recoveries });
    }
  }

  /**
   * Compute stale threshold in milliseconds from a cron expression.
   * Returns 2x the interval between runs, or 24h fallback if unparseable.
   */
  private computeStaleThreshold(schedule: string | null, multiplier: number): number {
    if (!schedule) {
      return ALERT_DEFAULTS.staleFallbackMs;
    }

    try {
      const interval = parseExpression(schedule);
      const next1 = interval.next().toDate().getTime();
      const next2 = interval.next().toDate().getTime();
      const intervalMs = next2 - next1;
      if (intervalMs <= 0) {
        return ALERT_DEFAULTS.staleFallbackMs;
      }
      return intervalMs * multiplier;
    } catch {
      return ALERT_DEFAULTS.staleFallbackMs;
    }
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this._onDidDetectAlerts.dispose();
  }
}
```

**Create `src/alerts/index.ts`:**

```typescript
export { AlertEngine } from './AlertEngine.js';
```

**Add `cron-parser` dependency:**

Run `pnpm add cron-parser` in the project root directory to add the dependency to package.json. The executor should run:

```bash
cd <project_root> && pnpm add cron-parser
```

If pnpm is not available, manually add `"cron-parser": "^4.9.0"` to the `dependencies` section of the root `package.json`.

</action>
<acceptance_criteria>
- src/alerts/AlertEngine.ts exists and exports `AlertEngine` class
- src/alerts/index.ts exists and re-exports `AlertEngine`
- AlertEngine implements `vscode.Disposable`
- AlertEngine has `private readonly stateMap = new Map<string, AlertState>()`
- AlertEngine has `public readonly onDidDetectAlerts` event
- AlertEngine has `public start(): void` method with `setInterval` at `ALERT_DEFAULTS.pollIntervalMs`
- AlertEngine has `private async evaluate(): Promise<void>` method
- AlertEngine has `private computeStaleThreshold(schedule: string | null, multiplier: number): number` method
- computeStaleThreshold uses `parseExpression` from `cron-parser`
- computeStaleThreshold falls back to `ALERT_DEFAULTS.staleFallbackMs` (24h) when schedule is null or unparseable
- AlertEngine.evaluate() iterates workspaces, checks `alertConfig.enabled`, skips disabled
- AlertEngine.evaluate() only fires `_onDidDetectAlerts` on state transitions
- package.json contains `cron-parser` in dependencies
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

## Verification

- `npx tsc --noEmit` exits 0
- `grep -r "export class AlertEngine" src/alerts/` returns a match
- `grep -r "AlertConfig" src/types/alerts.ts` returns a match
- `grep "alertConfig" src/types/workspace.ts` returns a match
- `grep "cron-parser" package.json` returns a match
