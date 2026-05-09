import type { RunReport } from '../../packages/shared/src/reports';

describe('RunReport summary union', () => {
  it('accepts success summaries with structured fields', () => {
    const report: RunReport = {
      agentId: 'claude-code-daily',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:02:00.000Z',
      status: 'success',
      durationMs: 120000,
      summary: {
        status: 'ok',
        oneLineSummary: 'Updated the daily status file and pushed a fresh run report.',
        bullets: ['Opened scheduled prompt', 'Generated report', 'Uploaded result'],
        tags: ['reporting', 'cron', 'claude-code'],
        tokenCount: 1842,
      },
    };

    expect(report.summary?.status).toBe('ok');
    if (report.summary?.status === 'ok') {
      expect(report.summary.bullets).toHaveLength(3);
      expect(report.summary.tags).toContain('cron');
      expect(report.summary.tokenCount).toBe(1842);
    }
  });

  it('accepts error summaries without leaking optional ok fields', () => {
    const report: RunReport = {
      agentId: 'claude-desktop-test-1',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:03:00.000Z',
      status: 'failure',
      durationMs: 180000,
      summary: {
        status: 'error',
        reason: 'claude exited with code 1',
      },
    };

    expect(report.summary).toEqual({
      status: 'error',
      reason: 'claude exited with code 1',
    });
  });
});
