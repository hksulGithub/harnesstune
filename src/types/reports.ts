import type { RalphReportBody } from '@harnesstune/shared';
export type { ReportEnvelope } from '@harnesstune/shared';

/** Extension-side status for remote workspaces -- superset of WorkspaceStatus */
export type RemoteWorkspaceStatus = 'running' | 'idle' | 'error' | 'stale' | 'relay_unreachable' | 'auth_error' | 'unknown';

/** Synthetic AgentEvent wrapping a relay report (per D-02 in CONTEXT.md) */
export interface RemoteReportEvent {
  type: 'remote_report';
  timestamp: string;
  workspaceId: string;
  report: import('@harnesstune/shared').ReportEnvelope;
}

/** Extension-side ralph loop report with computed delta */
export interface RalphLoopReport {
  loopId: string;
  iteration: number;
  metrics: Record<string, number>;
  baselineMetrics: Record<string, number>;
  delta: Record<string, number>;  // computed: metrics[key] - baselineMetrics[key]
  whatChanged: string;
  cumulativeProgress: string;
  generatedAt: string;
  reportId: string;
}

/** Extension-side daily briefing report */
export interface DailyBriefingReport {
  goals: string[];
  progress: string;
  blockers: string[];
  nextSteps: string[];
  metrics: Record<string, number>;
  generatedAt: string;
  reportId: string;
}

/** Helper: compute delta from ralph report body */
export function computeRalphDelta(body: RalphReportBody): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const key of Object.keys(body.metrics)) {
    delta[key] = body.metrics[key] - (body.baselineMetrics[key] ?? 0);
  }
  return delta;
}
