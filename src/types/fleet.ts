export type HealthState = 'healthy' | 'degraded' | 'failing' | 'no-data';
export type CostTrend = 'up' | 'down' | 'flat';

export interface FleetWorkspaceSummary {
  id: string;
  name: string;
  platform: string;
  health: HealthState;
  agentCount: number;
  errorRatePct: number;
  lastActivityTs: number;
}

export interface FleetAgentSummary {
  id: string;
  name: string;
  health: HealthState;
  successRatePct: number;
  lastRunTs: number;
  costUsd: number;
  costTrend: CostTrend;
}

export interface FleetRunRecord {
  runId: string;
  timestampTs: number;
  durationMs: number;
  status: HealthState;
  costUsd: number;
  logText: string;
}

export interface FleetCostSummary {
  totalCostUsd: number;
  totalTokens: number;
  trend: CostTrend;
}

export interface FleetWorkspaceDetail {
  agents: FleetAgentSummary[];
  cost: FleetCostSummary;
}

export interface FleetAgentDetail {
  runs: FleetRunRecord[];
  cost: FleetCostSummary;
}
