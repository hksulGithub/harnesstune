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
}

/** A message from the relay messages API */
export interface RelayMessage {
  id: string;
  channelId: string;
  direction: 'to_agent' | 'from_agent';
  body: { text: string; sentAt: string; inReplyToReportId?: string };
  createdAt: string;
}

/** Unified timeline item — report or chat message */
export type TimelineItem =
  | { kind: 'report'; data: ReportEnvelope; at: string }
  | { kind: 'message'; data: RelayMessage; at: string };
