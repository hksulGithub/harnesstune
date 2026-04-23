import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { ScheduledTask, SessionFile } from './types.js';

export function mapScheduledTask(task: ScheduledTask): AgentIdentity {
  return {
    agentId: task.id,
    name: task.id,
    platform: 'claude-desktop',
    schedule: task.cronExpression,
    lastRunAt: task.lastRunAt ?? null,
    status: task.enabled ? 'active' : 'paused',
  };
}

export function mapSessionToRunReport(session: SessionFile, taskId: string): RunReport {
  return {
    agentId: taskId,
    startedAt: new Date(session.createdAt).toISOString(),
    finishedAt: new Date(session.lastActivityAt).toISOString(),
    status: session.error ? 'failure' : 'success',
    durationMs: session.lastActivityAt - session.createdAt,
    errorSummary: session.error,
    logExcerpt: session.error ? `[${session.model}] ${session.error}` : undefined,
  };
}
