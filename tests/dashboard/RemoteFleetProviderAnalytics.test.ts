import { RemoteFleetProvider } from '../../src/providers/RemoteFleetProvider';

describe('RemoteFleetProvider analytics', () => {
  it('computes run count, average duration, and success rate for 24h/7d/30d windows', async () => {
    const registry = {
      getAll: () => [{ id: 'ws-1', name: 'WS 1' }],
    } as any;

    const client = {
      getSummary: async () => ({
        channelId: 'c1',
        days: 30,
        agents: [{ agentId: 'agent-1', totalRuns: 3, successCount: 2, failureCount: 1, successRate: 2 / 3, totalCostCents: 0, lastRunAt: '2026-05-09T00:00:00.000Z' }],
      }),
      getAgents: async () => [{ agentId: 'agent-1', name: 'Agent 1' }],
      getRuns: async () => ([
        { id: 'r1', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 2 * 3600000).toISOString(), finishedAt: new Date().toISOString(), status: 'success', durationMs: 1000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
        { id: 'r2', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 3 * 86400000).toISOString(), finishedAt: new Date().toISOString(), status: 'failure', durationMs: 3000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
        { id: 'r3', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 20 * 86400000).toISOString(), finishedAt: new Date().toISOString(), status: 'success', durationMs: 5000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
      ]),
    } as any;

    const provider = new RemoteFleetProvider(new Map([['ws-1', client]]), registry);
    const detail = await provider.getWorkspaceDetail('ws-1', 30);

    expect(detail.analytics.map((item) => item.label)).toEqual(['24h', '7d', '30d']);
    expect(detail.analytics[0].runCount).toBe(1);
    expect(detail.analytics[1].runCount).toBe(2);
    expect(detail.analytics[2].runCount).toBe(3);
  });
});
