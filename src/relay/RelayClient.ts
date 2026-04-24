import type { AgentIdentity } from '../types/workspace.js';

export interface RelayClientConfig {
  relayUrl: string;   // e.g. 'https://harnesstune-relay.vercel.app/api'
  token: string;      // Bearer token
  channelId: string;
}

export interface RelayHealthResponse {
  status: string;
  version: string;
}

/** Shape returned by GET /channels/:channelId/reports (metadata list — no body) */
export interface ReportListItem {
  id: string;
  channelId: string;
  type: string;
  agentId?: string | null;
  /** ISO timestamp mapped from the relay DB createdAt field */
  generatedAt: string;
}

export interface RelayMessagePayload {
  text: string;
  sentAt: string;
}

export interface AgentSummary {
  agentId: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  totalCostCents: number;
  lastRunAt: string | null;
}

export interface ChannelSummaryResponse {
  channelId: string;
  days: number;
  agents: AgentSummary[];
}

export interface RunRecord {
  id: string;
  channelId: string;
  agentId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  durationMs: number;
  logExcerpt: string | null;
  errorSummary: string | null;
  tokenUsage: string | null;
  costCents: number | null;
}

export class RelayClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly channelId: string;

  constructor(config: RelayClientConfig) {
    this.baseUrl = config.relayUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.channelId = config.channelId;
  }

  /** Check relay health. Returns true if reachable. */
  async checkHealth(): Promise<RelayHealthResponse> {
    const res = await this.doFetch('/health', { timeout: 8000 });
    if (!res.ok) { throw new Error(`Health check failed: ${res.status}`); }
    return res.json() as Promise<RelayHealthResponse>;
  }

  /** Fetch all agents for the channel */
  async getAgents(): Promise<AgentIdentity[]> {
    const res = await this.doFetch(`/channels/${this.channelId}/agents`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { agents: AgentIdentity[] };
    return data.agents;
  }

  /** Fetch paginated run history for a specific agent */
  async getRuns(agentId: string, since?: string, limit = 20): Promise<RunRecord[]> {
    const params = new URLSearchParams();
    if (since) { params.set('since', since); }
    params.set('limit', String(limit));
    const url = `/channels/${this.channelId}/agents/${agentId}/runs${params.toString() ? '?' + params.toString() : ''}`;
    const res = await this.doFetch(url, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { runs: RunRecord[] };
    return data.runs;
  }

  /** Fetch pre-aggregated summary for the channel */
  async getSummary(days = 7): Promise<ChannelSummaryResponse> {
    const res = await this.doFetch(`/channels/${this.channelId}/summary?days=${days}`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    return res.json() as Promise<ChannelSummaryResponse>;
  }

  private async doFetch(path: string, opts: { method?: string; body?: string; timeout?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout ?? 5000);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      };
      return await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Error with HTTP status for distinguishing 401 vs network errors */
export class RelayError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Relay error ${status}: ${message}`);
    this.name = 'RelayError';
  }
}
