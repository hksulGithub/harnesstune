import type { ReportEnvelope, RelayMessage } from '@harnesstune/shared';
import type { AgentIdentity } from '../types/workspace';

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

/** @deprecated Use ReportListItem */
export interface RelayReportListItem {
  id: string;
  type: string;
  generatedAt: string;
  reportId: string;
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
  lastRunAt: number | null;
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
  private isFirstPoll = true;

  constructor(config: RelayClientConfig) {
    // Strip trailing slash from relayUrl
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

  /**
   * Fetch report list since cursor. Returns ReportListItem[] with generatedAt mapped from DB createdAt.
   * The relay GET list endpoint returns { id, channelId, type, agentId, createdAt } — not a full
   * ReportEnvelope. generatedAt is mapped here so cursor advancement in RemoteAdapter works correctly.
   */
  async getReports(since?: string): Promise<ReportListItem[]> {
    const timeout = this.isFirstPoll ? 8000 : 5000;
    this.isFirstPoll = false;
    const params = new URLSearchParams();
    if (since) { params.set('since', since); }
    const url = `/channels/${this.channelId}/reports${params.toString() ? '?' + params.toString() : ''}`;
    const res = await this.doFetch(url, { timeout });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { reports?: Array<{ id: string; channelId: string; type: string; agentId?: string | null; createdAt: string }> };
    const rows = data.reports ?? [];
    // Map createdAt → generatedAt so cursor logic in RemoteAdapter reads the correct field
    return rows.map(r => ({
      id: r.id,
      channelId: r.channelId,
      type: r.type,
      agentId: r.agentId,
      generatedAt: r.createdAt,
    }));
  }

  /** Fetch a single report by ID. */
  async getReport(reportId: string): Promise<ReportEnvelope> {
    const res = await this.doFetch(`/channels/${this.channelId}/reports/${reportId}`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    return res.json() as Promise<ReportEnvelope>;
  }

  /** Fetch messages since cursor. Returns array of RelayMessage. */
  async getMessages(since?: string, limit = 50): Promise<RelayMessage[]> {
    const params = new URLSearchParams();
    if (since) { params.set('since', since); }
    params.set('limit', String(limit));
    const url = `/channels/${this.channelId}/messages${params.toString() ? '?' + params.toString() : ''}`;
    const res = await this.doFetch(url, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { messages?: RelayMessage[] } | RelayMessage[];
    return (data as { messages?: RelayMessage[] }).messages ?? (data as RelayMessage[]);
  }

  /** Post a message to the agent. */
  async postMessage(text: string, inReplyToReportId?: string): Promise<void> {
    const body: Record<string, unknown> = { text, sentAt: new Date().toISOString() };
    if (inReplyToReportId) { body.inReplyToReportId = inReplyToReportId; }
    const payload = { direction: 'to_agent', body };
    const res = await this.doFetch(`/channels/${this.channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
      timeout: 5000,
    });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
  }

  /** Fetch channel metadata (for auto-naming and channel ID discovery). */
  async getChannel(): Promise<{ id: string; name?: string; createdAt?: string }> {
    const res = await this.doFetch(`/channels/${this.channelId}`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    return res.json() as Promise<{ id: string; name?: string; createdAt?: string }>;
  }

  /**
   * Discover the channel ID that the current token is scoped to.
   * Calls GET /channels/me (or equivalent token-introspection endpoint).
   * Returns the channelId string.
   */
  async discoverChannelId(): Promise<string> {
    const res = await this.doFetch('/channels/me', { timeout: 8000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { channelId?: string; id?: string };
    const channelId = data.channelId ?? data.id;
    if (!channelId) {
      throw new RelayError(0, 'Channel ID not found in /channels/me response');
    }
    return channelId;
  }

  /** Fetch all agents for the channel */
  async getAgents(): Promise<AgentIdentity[]> {
    const res = await this.doFetch(`/channels/${this.channelId}/agents`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { agents: AgentIdentity[] };
    return data.agents;
  }

  /** Register an agent with the channel */
  async registerAgent(agentId: string, platform: string, name?: string, schedule?: string): Promise<AgentIdentity> {
    const body: Record<string, string> = { agentId, platform };
    if (name) { body.name = name; }
    if (schedule) { body.schedule = schedule; }
    const res = await this.doFetch(`/channels/${this.channelId}/agents`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 5000,
    });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    return res.json() as Promise<AgentIdentity>;
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
    // 15s timeout: Vercel cold-start + Turso DB roundtrip can exceed 5s when this
    // function hasn't been hit recently (the dashboard hits /summary on demand,
    // so it doesn't stay warm like the 30s poll cycle does).
    const res = await this.doFetch(`/channels/${this.channelId}/summary?days=${days}`, { timeout: 15000 });
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
      console.debug('HarnessTune RelayClient:', opts.method ?? 'GET', path, '(Bearer [REDACTED])');
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
