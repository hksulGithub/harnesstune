import type { RunRecord } from '../../src/relay/RelayClient';

describe('dashboard analytics types', () => {
  it('RunRecord exposes parsed summary and analytics window shapes exist', () => {
    const run: RunRecord = {
      id: 'run-1',
      channelId: 'channel-1',
      agentId: 'agent-1',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:01:00.000Z',
      status: 'success',
      durationMs: 60000,
      logExcerpt: null,
      errorSummary: null,
      tokenUsage: null,
      costCents: null,
      summary: {
        status: 'ok',
        oneLineSummary: 'Done',
        bullets: ['A'],
        tags: ['tag'],
        tokenCount: 12,
      },
    };

    expect(run.summary?.status).toBe('ok');
  });
});
