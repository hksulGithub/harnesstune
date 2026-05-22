/** Paperclip API response types — assumed shapes based on REST API conventions */

export interface PaperclipCompany {
  id: string;
  name: string;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string | null;
  title: string | null;
  icon: string | null;
  status: string | null;
  reportsTo: string | null;
  capabilities: unknown;
  adapterType: string;
  adapterConfig: unknown;
  runtimeConfig: {
    heartbeat?: {
      enabled?: boolean;
      cooldownSec?: number;
      intervalSec?: number;
      wakeOnDemand?: boolean;
      maxConcurrentRuns?: number;
    } | null;
  } | null;
  budgetMonthlyCents: number | null;
  spentMonthlyCents: number | null;
  permissions: unknown;
  lastHeartbeatAt: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  urlKey: string;
}

export interface PaperclipTaskDefinition {
  id: string;
  companyId: string;
  agentId: string;
  adapterType: string;
  taskKey: string;
  sessionParamsJson: unknown;
  sessionDisplayId: string | null;
  lastRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperclipCostEntry {
  agentId: string;
  agentName: string;
  agentStatus: string | null;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface PaperclipActivity {
  id: string;
  companyId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  agentId: string;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PaperclipHeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  invocationSource: string | null;
  triggerDetail: string | null;
  status: 'succeeded' | 'failed' | 'running';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  wakeupRequestId: string | null;
  exitCode: number | null;
  signal: string | null;
  usageJson: {
    costUsd?: number | null;
    billingType?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
  } | null;
  resultJson: unknown;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  logStore: string | null;
  logRef: string | null;
  logBytes: number | null;
  logSha256: string | null;
  logCompressed: boolean | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  errorCode: string | null;
  externalRunId: string | null;
  contextSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Paginated response wrapper for list endpoints */
export interface PaperclipPaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
}
