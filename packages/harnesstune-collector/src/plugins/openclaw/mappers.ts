import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { OpenClawSession } from './types.js';

/**
 * Maps an OpenClaw agent directory name to an AgentIdentity.
 * The directory name serves as both the agentId and human-readable name.
 */
export function mapAgentDir(dirName: string): AgentIdentity {
  return {
    agentId: dirName,
    name: dirName,
    platform: 'openclaw',
    schedule: null,
    lastRunAt: null,
    status: 'active',
  };
}

/**
 * Maps a segmented OpenClawSession to a RunReport.
 * Status is inferred from presence of error-type events or non-zero exit codes.
 * Log excerpt is truncated to the last 50 lines.
 */
export function mapSessionToRunReport(session: OpenClawSession): RunReport {
  const failed = session.events.some(
    e => e.type === 'error' || (e.exitCode != null && e.exitCode !== 0),
  );
  return {
    agentId: session.agentId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    status: failed ? 'failure' : 'success',
    durationMs:
      new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime(),
    logExcerpt:
      session.events
        .map(e => e.logLine)
        .filter(Boolean)
        .slice(-50)
        .join('\n') || undefined,
    errorSummary: failed
      ? session.events.find(e => e.type === 'error')?.logLine
      : undefined,
  };
}
