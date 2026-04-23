import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { CronRunFile, CrontabEntry } from './types.js';

export function mapCrontabEntry(entry: CrontabEntry): AgentIdentity {
  return {
    agentId: entry.agentName,
    name: entry.agentName,
    platform: 'claude-code',
    schedule: entry.schedule,
    lastRunAt: null,
    status: 'active',
  };
}

export function mapCronRunFile(file: CronRunFile): RunReport {
  const isFailed = file.exitCode !== 0;
  return {
    agentId: file.agentName,
    startedAt: file.startedAt,
    finishedAt: file.finishedAt,
    status: isFailed ? 'failure' : 'success',
    durationMs: file.durationMs,
    logExcerpt: file.outputTail,
    errorSummary: isFailed
      ? `Exit code ${file.exitCode}: ${file.outputTail.split('\n').slice(-3).join(' | ')}`
      : undefined,
  };
}
