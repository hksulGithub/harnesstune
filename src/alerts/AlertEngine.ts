import * as vscode from 'vscode';
import { CronExpressionParser } from 'cron-parser';
import type { FleetDataProvider } from '../providers/FleetDataProvider.js';
import type { IWorkspaceRegistry } from '../types/workspace.js';
import type {
  AlertState,
  AlertTransition,
  AlertCycleSummary,
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
      const interval = CronExpressionParser.parse(schedule);
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
