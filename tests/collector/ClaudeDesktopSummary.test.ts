import { mapSessionToRunReport } from '../../packages/harnesstune-collector/src/plugins/claude-desktop/mappers';

describe('ClaudeDesktop summary wiring', () => {
  it('maps session metadata to a run report before summary attachment', () => {
    const report = mapSessionToRunReport({
      sessionId: 'abc',
      scheduledTaskId: 'task-1',
      createdAt: 1000,
      lastActivityAt: 4000,
      isArchived: false,
      title: 'Run task',
      model: 'claude-opus-4-5',
      transcriptPath: '/tmp/local_abc.md',
    }, 'task-1');

    expect(report.agentId).toBe('task-1');
    expect(report.summary).toBeUndefined();
  });
});
