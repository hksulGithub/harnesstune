/** Raw scheduled task entry from scheduled-tasks.json */
export interface ScheduledTask {
  id: string;
  cronExpression: string;
  enabled: boolean;
  filePath: string;
  model: string;
  /** Epoch ms */
  createdAt: number;
  /** ISO 8601 or undefined */
  lastRunAt?: string;
  /** ISO 8601 or undefined */
  lastScheduledFor?: string;
  approvedPermissions: Array<{ toolName: string }>;
  disableJitter: boolean;
}

/** Wrapper for the scheduled-tasks.json file format */
export interface ScheduledTasksFile {
  scheduledTasks: ScheduledTask[];
}

/** Raw session metadata from local_<uuid>.json plus enrichment fields. */
export interface SessionFile {
  sessionId: string;
  /** Present when this session was triggered by a scheduled task. Required for collection. */
  scheduledTaskId?: string;
  sessionType?: string;
  /** Epoch ms */
  createdAt: number;
  /** Epoch ms — last persisted activity; used as the time-based watermark. */
  lastActivityAt: number;
  error?: string;
  isArchived: boolean;
  title: string;
  model: string;
  /** Absolute path to the session JSON, set by readSessionFile. */
  sessionPath?: string;
  /** Absolute path to the sibling transcript .md, or null if none exists. */
  transcriptPath?: string | null;
}
