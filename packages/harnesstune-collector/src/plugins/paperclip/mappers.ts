import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { PaperclipAgent, PaperclipHeartbeatRun, PaperclipActivity } from './types.js';

/** Map a Paperclip agent to the collector's AgentIdentity */
export function mapAgent(agent: PaperclipAgent): AgentIdentity {
  const intervalSec = agent.runtimeConfig?.heartbeat?.intervalSec;
  const schedule =
    intervalSec != null && intervalSec > 0 && intervalSec % 60 === 0
      ? `*/${intervalSec / 60} * * * *`
      : null;

  return {
    agentId: agent.id,
    name: agent.name,
    platform: 'paperclip',
    schedule,
    lastRunAt: agent.lastHeartbeatAt ?? null,
    status: agent.status ?? 'unknown',
  };
}

/** Map a Paperclip heartbeat run to the shared RunReport type */
export function mapHeartbeatRun(run: PaperclipHeartbeatRun): RunReport {
  const statusMap = {
    succeeded: 'success',
    failed: 'failure',
    running: 'running',
  } as const;
  const durationMs =
    run.finishedAt != null
      ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
      : 0;
  const usage = run.usageJson;
  const tokenUsage =
    usage?.inputTokens != null && usage?.outputTokens != null
      ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
      : undefined;
  const resultExcerpt =
    run.resultJson != null
      ? JSON.stringify(run.resultJson)?.slice(0, 500)
      : undefined;

  return {
    agentId: run.agentId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? run.startedAt,
    status: statusMap[run.status],
    durationMs,
    logExcerpt: run.stdoutExcerpt ?? run.stderrExcerpt ?? resultExcerpt,
    errorSummary: run.error ?? run.errorCode ?? undefined,
    tokenUsage,
    costCents: usage?.costUsd != null ? Math.round(usage.costUsd * 100) : undefined,
  };
}

/** Map Paperclip activity entries to minimal RunReport events. */
export function mapActivitiesToEvents(
  activities: PaperclipActivity[],
): RunReport[] {
  return activities.map(a => ({
    agentId: a.agentId,
    startedAt: a.createdAt,
    finishedAt: a.createdAt,
    status: 'success' as const,
    durationMs: 0,
    logExcerpt: `[${a.action}] ${a.details != null ? JSON.stringify(a.details) : ''}`.trim(),
  }));
}
