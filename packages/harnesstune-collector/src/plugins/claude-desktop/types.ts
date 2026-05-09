export interface ScheduledTask {
  id: string;
  cronExpression: string;
  enabled: boolean;
  filePath: string;
  model: string;
  createdAt: number;
  lastRunAt?: string;
  lastScheduledFor?: string;
  approvedPermissions: Array<{ toolName: string }>;
  disableJitter: boolean;
}

export interface ScheduledTasksFile {
  scheduledTasks: ScheduledTask[];
}

export interface SessionFile {
  sessionId: string;
  scheduledTaskId?: string;
  sessionType?: string;
  createdAt: number;
  lastActivityAt: number;
  error?: string;
  isArchived: boolean;
  title: string;
  model: string;
  sessionPath?: string;
  transcriptPath?: string | null;
}
