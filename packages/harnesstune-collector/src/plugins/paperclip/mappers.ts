import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { PaperclipAgent, PaperclipTaskSession, PaperclipCostEntry, PaperclipActivity } from './types.js';

/** Map a Paperclip agent to the collector's AgentIdentity */
export function mapAgent(agent: PaperclipAgent): AgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    platform: 'paperclip',
    schedule: agent.schedule ?? null,
    lastRunAt: agent.lastRunAt ?? null,
    status: agent.status ?? 'unknown',
  };
}

/** Map a Paperclip task session to the shared RunReport type */
export function mapTaskSession(session: PaperclipTaskSession): RunReport {
  const durationMs =
    session.durationMs ??
    (new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime());

  const tokenUsage =
    session.inputTokens != null && session.outputTokens != null
      ? { inputTokens: session.inputTokens, outputTokens: session.outputTokens }
      : undefined;

  return {
    agentId: session.agentId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    status: session.status,
    durationMs,
    logExcerpt: session.logExcerpt,
    errorSummary: session.errorSummary,
    tokenUsage,
    costCents: session.costCents,
  };
}

/**
 * D-03 fallback: enrich runs that are missing costCents from batch cost data.
 * Costs are per-agent per-day; match by agentId + date portion of finishedAt.
 * Only patches runs where costCents is null/undefined.
 */
export function enrichWithCosts(
  runs: RunReport[],
  costs: PaperclipCostEntry[],
): RunReport[] {
  if (costs.length === 0) return runs;
  const costMap = new Map(costs.map(c => [`${c.agentId}:${c.date}`, c.costCents]));
  return runs.map(r => {
    if (r.costCents != null) return r;
    const date = r.finishedAt.slice(0, 10); // 'YYYY-MM-DD'
    const cents = costMap.get(`${r.agentId}:${date}`);
    return cents != null ? { ...r, costCents: cents } : r;
  });
}

/**
 * Map Paperclip activity events to supplementary RunReport fields.
 * Activities that can be correlated to a run (by agentId + time proximity)
 * are appended to the run's logExcerpt. Standalone activities are returned
 * as minimal RunReports with status 'success' and zero duration.
 */
export function mapActivitiesToEvents(
  activities: PaperclipActivity[],
): RunReport[] {
  return activities.map(a => ({
    agentId: a.agentId,
    startedAt: a.occurredAt,
    finishedAt: a.occurredAt,
    status: 'success' as const,
    durationMs: 0,
    logExcerpt: `[${a.eventType}] ${a.detail ?? ''}`.trim(),
  }));
}
