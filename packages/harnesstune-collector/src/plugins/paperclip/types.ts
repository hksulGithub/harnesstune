/** Paperclip API response types — assumed shapes based on REST API conventions */

export interface PaperclipCompany {
  id: string;
  name: string;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  schedule?: string;       // cron expression or null
  lastRunAt?: string;      // ISO 8601
  status?: string;         // 'active' | 'paused' | 'disabled' etc.
}

export interface PaperclipTaskSession {
  id: string;
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs?: number;
  logExcerpt?: string;
  errorSummary?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}

export interface PaperclipCostEntry {
  agentId: string;
  costCents: number;
  date: string;            // ISO 8601 date (YYYY-MM-DD)
}

export interface PaperclipActivity {
  id: string;
  agentId: string;
  eventType: string;
  occurredAt: string;      // ISO 8601
  detail?: string;
}

/** Paginated response wrapper for list endpoints */
export interface PaperclipPaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
}
