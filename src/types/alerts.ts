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
