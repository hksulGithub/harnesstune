import type { RunReportSummary } from '@harnesstune/shared';

export type HealthState = 'healthy' | 'degraded' | 'failing' | 'no-data';
export type CostTrend = 'up' | 'down' | 'flat';
export type AnalyticsWindowKey = '24h' | '7d' | '30d';

export interface AnalyticsWindowStats {
  label: AnalyticsWindowKey;
  runCount: number;
  averageDurationMs: number;
  successRatePct: number;
}

export interface FleetWorkspaceSummary {
  id: string;
  name: string;
  platform: string;
  health: HealthState;
  agentCount: number;
  errorRatePct: number;
  lastActivityTs: number;
  analytics: AnalyticsWindowStats[];
}

export interface FleetAgentSummary {
  id: string;
  name: string;
  health: HealthState;
  successRatePct: number;
  lastRunTs: number;
  costUsd: number;
  costTrend: CostTrend;
  analytics: AnalyticsWindowStats[];
}

export interface FleetRunRecord {
  runId: string;
  timestampTs: number;
  durationMs: number;
  status: HealthState;
  costUsd: number;
  logText: string;
  summary?: RunReportSummary | null;
}

export interface FleetCostSummary {
  totalCostUsd: number;
  totalTokens: number;
  trend: CostTrend;
}

export interface FleetWorkspaceDetail {
  agents: FleetAgentSummary[];
  cost: FleetCostSummary;
  analytics: AnalyticsWindowStats[];
}

export interface FleetAgentDetail {
  runs: FleetRunRecord[];
  cost: FleetCostSummary;
  analytics: AnalyticsWindowStats[];
}
