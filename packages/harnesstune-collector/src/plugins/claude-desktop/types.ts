/** Raw scheduled task entry from scheduled-tasks.json */
export interface ScheduledTask {
  id: string;
  cronExpression: string;
  enabled: boolean;
  filePath: string;
  model: string;
  createdAt: number;  // epoch ms
  lastRunAt?: string; // ISO 8601 or undefined
  lastScheduledFor?: string; // ISO 8601 or undefined
  approvedPermissions: Array<{ toolName: string }>;
  disableJitter: boolean;
}

/** Wrapper for the scheduled-tasks.json file format */
export interface ScheduledTasksFile {
  scheduledTasks: ScheduledTask[];
}

/** Raw session metadata from local_<uuid>.json */
export interface SessionFile {
  sessionId: string;
  scheduledTaskId?: string;
  sessionType?: string;
  createdAt: number;       // epoch ms
  lastActivityAt: number;  // epoch ms
  error?: string;
  isArchived: boolean;
  title: string;
  model: string;
}
