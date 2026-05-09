import { mapCronRunFile } from '../../packages/harnesstune-collector/src/plugins/claude-code/mappers';

describe('ClaudeCode summary wiring', () => {
  it('preserves main run success when summary generation fails', () => {
    const report = mapCronRunFile({
      agentName: 'daily-report',
      command: 'claude -p report',
      exitCode: 0,
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:01:00.000Z',
      durationMs: 60000,
      outputTail: 'ok',
      transcriptPath: '/tmp/transcript.md',
    });

    expect(report.status).toBe('success');
    expect(report.summary).toBeUndefined();
  });
});
