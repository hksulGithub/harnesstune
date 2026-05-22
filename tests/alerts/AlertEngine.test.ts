import { AlertEngine } from '../../src/alerts/AlertEngine';
import type { FleetDataProvider } from '../../src/providers/FleetDataProvider';
import type { IWorkspaceRegistry, WorkspaceRecord } from '../../src/types/workspace';
import type { AlertCycleSummary } from '../../src/types/alerts';

function makeWorkspace(): WorkspaceRecord {
  return {
    id: 'ws-1',
    name: 'Workspace 1',
    rootPath: '/tmp/ws-1',
    status: 'running',
    addedAt: '2026-05-09T00:00:00.000Z',
    lastUpdatedAt: '2026-05-09T00:00:00.000Z',
    runningAgentCount: 0,
    errorCount: 0,
    backendType: 'claude-code',
    mode: 'local',
    agents: [{
      id: 'agent-1',
      agentId: 'agent-1',
      name: 'Agent 1',
      platform: 'claude-code',
      schedule: '*/5 * * * *',
      lastRunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      status: 'active',
    }],
  };
}

function makeRegistry(workspaces: WorkspaceRecord[]): IWorkspaceRegistry {
  return {
    getAll: () => workspaces,
    getById: (id: string) => workspaces.find(ws => ws.id === id),
    add: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    onDidChange: jest.fn(),
  } as unknown as IWorkspaceRegistry;
}

describe('AlertEngine', () => {
  it('formats sub-hour stale thresholds in minutes instead of 0h', async () => {
    const lastRunTs = Date.now() - 60 * 60 * 1000;
    const fleetProvider: FleetDataProvider = {
      getWorkspaceSummaries: jest.fn(),
      getAgentDetail: jest.fn(),
      getWorkspaceDetail: jest.fn().mockResolvedValue({
        cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' },
        agents: [{
          id: 'agent-1',
          name: 'Agent 1',
          health: 'healthy',
          successRatePct: 100,
          lastRunTs,
          costUsd: 0,
          costTrend: 'flat',
        }],
      }),
    };
    const engine = new AlertEngine(fleetProvider, makeRegistry([makeWorkspace()]));
    const summaries: AlertCycleSummary[] = [];
    engine.onDidDetectAlerts(summary => summaries.push(summary));

    await (engine as unknown as { evaluate(): Promise<void> }).evaluate();

    expect(summaries).toHaveLength(1);
    expect(summaries[0].problems).toHaveLength(1);
    expect(summaries[0].problems[0].reason).toContain('threshold: 10m');
    expect(summaries[0].problems[0].reason).not.toContain('threshold: 0h');
    engine.dispose();
  });
});
