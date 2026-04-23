/**
 * @harnesstune/shared -- Report body schemas
 * Single source of truth. Imported by @harnesstune/agent and the extension.
 */

export type ReportType = 'briefing' | 'ralph' | 'heartbeat';

export interface BriefingReportBody {
  goals: string[];
  progress: string;
  blockers: string[];
  nextSteps: string[];
  metrics: Record<string, number>;
}

export interface RalphReportBody {
  loopId: string;
  iteration: number;
  metrics: Record<string, number>;
  baselineMetrics: Record<string, number>;
  whatChanged: string;
  cumulativeProgress: string;
}

export interface HeartbeatReportBody {
  status: 'connected' | 'disconnected';
  uptimeSeconds: number;
}

/** Envelope for uploading reports to relay */
export interface ReportEnvelope {
  type: ReportType;
  body: BriefingReportBody | RalphReportBody | HeartbeatReportBody;
  /** ISO 8601 timestamp of when the report was generated */
  generatedAt: string;
  /** UUID v4 unique identifier for this report */
  reportId: string;
  /** Optional agent identifier for per-agent attribution — D-01 */
  agentId?: string;
}

/** Structured execution record from a collector/agent run — stored in agent_runs table, NOT a ReportEnvelope type */
export interface RunReport {
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs: number;
  logExcerpt?: string;     // truncated log output
  errorSummary?: string;   // error message if failed
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  costCents?: number;
}

export type RunStatus = RunReport['status'];

/** A message from the relay messages API */
export interface RelayMessage {
  id: string;
  channelId: string;
  direction: 'to_agent' | 'from_agent';
  body: { text: string; sentAt: string; inReplyToReportId?: string };
  createdAt: string;
}

/** Local agent activity — synthesised from hook events */
export interface ActivityItem {
  eventType: string;
  toolName?: string;
  model?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionId: string;
}

/** Unified timeline item — report, chat message, or local activity */
export type TimelineItem =
  | { kind: 'report'; data: ReportEnvelope; at: string }
  | { kind: 'message'; data: RelayMessage; at: string }
  | { kind: 'activity'; data: ActivityItem; at: string };
