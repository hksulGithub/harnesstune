import { RelayClient } from '../relay/RelayClient.js';
import type { AgentSummary } from '../relay/RelayClient.js';
import type { FleetDataProvider } from './FleetDataProvider.js';
import type {
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

const STALE_THRESHOLD_MS = 24 * 3600 * 1000;

function computeHealthFromSummary(a: AgentSummary): HealthState {
  if (a.totalRuns === 0) { return 'no-data'; }
  if (a.successRate < 0.5) { return 'failing'; }
  const lastRunMs = a.lastRunAt !== null ? a.lastRunAt * 1000 : 0;
  const isStale = lastRunMs > 0 && Date.now() - lastRunMs > STALE_THRESHOLD_MS;
  if (isStale) { return 'degraded'; }
  if (a.failureCount === 0) { return 'healthy'; }
  return 'degraded';
}

function computeHealthFromAgentSummaries(agents: AgentSummary[]): HealthState {
  const healths = agents.map(computeHealthFromSummary);
  if (healths.some(h => h === 'failing')) { return 'failing'; }
  if (healths.some(h => h === 'degraded')) { return 'degraded'; }
  if (healths.every(h => h === 'no-data')) { return 'no-data'; }
  return 'healthy';
}

function mapRunStatus(status: string): HealthState {
  switch (status) {
    case 'success': return 'healthy';
    case 'running': return 'healthy';
    case 'failure': return 'failing';
    case 'timeout': return 'failing';
    default: return 'degraded';
  }
}

export class RemoteFleetProvider implements FleetDataProvider {
  private readonly clients: Map<string, RelayClient>;
  private readonly registry: IWorkspaceRegistry;

  constructor(clients: Map<string, RelayClient>, registry: IWorkspaceRegistry) {
    this.clients = clients;
    this.registry = registry;
  }

  async getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]> {
    const workspaces = this.registry.getAll();
    const summaries: FleetWorkspaceSummary[] = [];

    for (const ws of workspaces) {
      const relayClient = this.clients.get(ws.id);
      if (!relayClient) { continue; }

      try {
        const channelSummary = await relayClient.getSummary(days);
        const agents = channelSummary.agents;
        const agentCount = agents.length;
        const totalRuns = agents.reduce((acc, a) => acc + a.totalRuns, 0);
        const totalFailures = agents.reduce((acc, a) => acc + a.failureCount, 0);
        const errorRatePct = totalRuns > 0 ? (totalFailures / totalRuns) * 100 : 0;
        const health = computeHealthFromAgentSummaries(agents);
        const lastActivityTs = agents.reduce((max, a) => {
          if (a.lastRunAt === null) { return max; }
          const ts = a.lastRunAt * 1000;
          return ts > max ? ts : max;
        }, 0);

        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health,
          agentCount,
          errorRatePct,
          lastActivityTs,
        });
      } catch (err) {
        console.error(`HarnessTune RemoteFleetProvider: getSummary failed for workspace "${ws.name}" (id=${ws.id}):`, err);
        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health: 'unreachable',
          agentCount: 0,
          errorRatePct: 0,
          lastActivityTs: 0,
        });
      }
    }

    return summaries;
  }

  async getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { agents: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' } };
    }

    const [channelSummary, agentIdentities] = await Promise.all([
      relayClient.getSummary(days),
      relayClient.getAgents(),
    ]);

    const identityMap = new Map(agentIdentities.map(a => [a.agentId, a]));

    const agents: FleetAgentSummary[] = channelSummary.agents.map(agentSummary => {
      const identity = identityMap.get(agentSummary.agentId);
      const health = computeHealthFromSummary(agentSummary);
      const lastRunTs = agentSummary.lastRunAt !== null ? agentSummary.lastRunAt * 1000 : 0;

      return {
        id: agentSummary.agentId,
        name: identity?.name ?? agentSummary.agentId,
        health,
        successRatePct: agentSummary.successRate * 100,
        lastRunTs,
        costUsd: agentSummary.totalCostCents / 100,
        costTrend: 'flat' as CostTrend,
      };
    });

    const totalCostUsd = agents.reduce((acc, a) => acc + a.costUsd, 0);
    const cost: FleetCostSummary = {
      totalCostUsd,
      totalTokens: 0,
      trend: 'flat',
    };

    return { agents, cost };
  }

  async getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { runs: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' } };
    }

    const cutoffMs = Date.now() - days * 86400000;
    const allRuns = await relayClient.getRuns(agentId);
    const filtered = allRuns.filter(r => Date.parse(r.startedAt) >= cutoffMs);

    const runs: FleetRunRecord[] = filtered.map(run => ({
      runId: run.id,
      timestampTs: Date.parse(run.startedAt),
      durationMs: run.durationMs,
      status: mapRunStatus(run.status),
      costUsd: (run.costCents ?? 0) / 100,
      logText: run.logExcerpt ?? run.errorSummary ?? '',
    }));

    runs.sort((a, b) => b.timestampTs - a.timestampTs);

    const totalCostUsd = runs.reduce((acc, r) => acc + r.costUsd, 0);
    const cost: FleetCostSummary = {
      totalCostUsd,
      totalTokens: 0,
      trend: 'flat',
    };

    return { runs, cost };
  }
}
