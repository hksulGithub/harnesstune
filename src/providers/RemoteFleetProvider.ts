import { RelayClient } from '../relay/RelayClient.js';
import type { AgentSummary, RunRecord } from '../relay/RelayClient.js';
import type { FleetDataProvider } from './FleetDataProvider.js';
import type {
  AnalyticsWindowKey,
  AnalyticsWindowStats,
  FleetWorkspaceSummary,
  FleetWorkspaceDetail,
  FleetAgentSummary,
  FleetAgentDetail,
  FleetRunRecord,
  FleetCostSummary,
  HealthState,
  CostTrend,
} from '../types/fleet.js';
import type { IWorkspaceRegistry } from '../types/workspace.js';

function computeHealthFromSummary(a: AgentSummary): HealthState {
  if (a.totalRuns === 0) return 'no-data';
  if (a.failureCount === 0) return 'healthy';
  if (a.successRate < 0.5) return 'failing';
  return 'degraded';
}

function computeHealthFromAgentSummaries(agents: AgentSummary[]): HealthState {
  const healths = agents.map(computeHealthFromSummary);
  if (healths.some((h) => h === 'failing')) return 'failing';
  if (healths.some((h) => h === 'degraded')) return 'degraded';
  if (healths.every((h) => h === 'no-data')) return 'no-data';
  return 'healthy';
}

function mapRunStatus(status: string): HealthState {
  switch (status) {
    case 'success':
    case 'running':
      return 'healthy';
    case 'failure':
    case 'timeout':
      return 'failing';
    default:
      return 'degraded';
  }
}

function buildAnalytics(runs: RunRecord[]): AnalyticsWindowStats[] {
  const windows: Array<{ label: AnalyticsWindowKey; cutoffMs: number }> = [
    { label: '24h', cutoffMs: Date.now() - 24 * 60 * 60 * 1000 },
    { label: '7d', cutoffMs: Date.now() - 7 * 24 * 60 * 60 * 1000 },
    { label: '30d', cutoffMs: Date.now() - 30 * 24 * 60 * 60 * 1000 },
  ];

  return windows.map(({ label, cutoffMs }) => {
    const filtered = runs.filter((run) => Date.parse(run.startedAt) >= cutoffMs);
    const runCount = filtered.length;
    const averageDurationMs = runCount === 0
      ? 0
      : Math.round(filtered.reduce((sum, run) => sum + run.durationMs, 0) / runCount);
    const successRatePct = runCount === 0
      ? 0
      : Math.round((filtered.filter((run) => run.status === 'success').length / runCount) * 100);
    return { label, runCount, averageDurationMs, successRatePct };
  });
}

export class RemoteFleetProvider implements FleetDataProvider {
  constructor(
    private readonly clients: Map<string, RelayClient>,
    private readonly registry: IWorkspaceRegistry,
  ) {}

  async getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]> {
    const workspaces = this.registry.getAll();
    const summaries: FleetWorkspaceSummary[] = [];

    for (const ws of workspaces) {
      const relayClient = this.clients.get(ws.id);
      if (!relayClient) continue;

      try {
        const channelSummary = await relayClient.getSummary(days);
        const agents = channelSummary.agents;
        const agentCount = agents.length;
        const totalRuns = agents.reduce((acc, a) => acc + a.totalRuns, 0);
        const totalFailures = agents.reduce((acc, a) => acc + a.failureCount, 0);
        const errorRatePct = totalRuns > 0 ? (totalFailures / totalRuns) * 100 : 0;
        const health = computeHealthFromAgentSummaries(agents);
        const lastActivityTs = agents.reduce((max, a) => {
          if (a.lastRunAt === null) return max;
          const ts = Date.parse(a.lastRunAt);
          return ts > max ? ts : max;
        }, 0);

        const runs = (await Promise.all(agents.map((agent) => relayClient.getRuns(agent.agentId)))).flat();
        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health,
          agentCount,
          errorRatePct,
          lastActivityTs,
          analytics: buildAnalytics(runs),
        });
      } catch {
        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health: 'no-data',
          agentCount: 0,
          errorRatePct: 0,
          lastActivityTs: 0,
          analytics: buildAnalytics([]),
        });
      }
    }

    return summaries;
  }

  async getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { agents: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' }, analytics: buildAnalytics([]) };
    }

    const [channelSummary, agentIdentities] = await Promise.all([
      relayClient.getSummary(days),
      relayClient.getAgents(),
    ]);

    const identityMap = new Map(agentIdentities.map((a) => [a.agentId, a]));
    const runsByAgent = new Map<string, RunRecord[]>();
    for (const agentSummary of channelSummary.agents) {
      runsByAgent.set(agentSummary.agentId, await relayClient.getRuns(agentSummary.agentId));
    }

    const agents: FleetAgentSummary[] = channelSummary.agents.map((agentSummary) => {
      const identity = identityMap.get(agentSummary.agentId);
      const health = computeHealthFromSummary(agentSummary);
      const lastRunTs = agentSummary.lastRunAt !== null ? Date.parse(agentSummary.lastRunAt) : 0;
      return {
        id: agentSummary.agentId,
        name: identity?.name ?? agentSummary.agentId,
        health,
        successRatePct: agentSummary.successRate * 100,
        lastRunTs,
        costUsd: agentSummary.totalCostCents / 100,
        costTrend: 'flat' as CostTrend,
        analytics: buildAnalytics(runsByAgent.get(agentSummary.agentId) ?? []),
      };
    });

    const totalCostUsd = agents.reduce((acc, a) => acc + a.costUsd, 0);
    const analytics = buildAnalytics(Array.from(runsByAgent.values()).flat());
    const cost: FleetCostSummary = { totalCostUsd, totalTokens: 0, trend: 'flat' };

    return { agents, cost, analytics };
  }

  async getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { runs: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' }, analytics: buildAnalytics([]) };
    }

    const cutoffMs = Date.now() - days * 86400000;
    const allRuns = await relayClient.getRuns(agentId);
    const filtered = allRuns.filter((r) => Date.parse(r.startedAt) >= cutoffMs);

    const runs: FleetRunRecord[] = filtered.map((run) => ({
      runId: run.id,
      timestampTs: Date.parse(run.startedAt),
      durationMs: run.durationMs,
      status: mapRunStatus(run.status),
      costUsd: (run.costCents ?? 0) / 100,
      logText: run.logExcerpt ?? run.errorSummary ?? '',
      summary: run.summary ?? null,
    }));

    runs.sort((a, b) => b.timestampTs - a.timestampTs);
    const totalCostUsd = runs.reduce((acc, r) => acc + r.costUsd, 0);
    const cost: FleetCostSummary = { totalCostUsd, totalTokens: 0, trend: 'flat' };

    return { runs, cost, analytics: buildAnalytics(filtered) };
  }
}
