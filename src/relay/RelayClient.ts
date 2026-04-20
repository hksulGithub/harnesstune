import type { ReportEnvelope } from '@harnesstune/shared';

export interface RelayClientConfig {
  relayUrl: string;   // e.g. 'https://harnesstune-relay.vercel.app/api'
  token: string;      // Bearer token
  channelId: string;
}

export interface RelayHealthResponse {
  status: string;
  version: string;
}

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

  /** Fetch reports since cursor. Returns array of ReportEnvelope. */
  async getReports(since?: string): Promise<ReportEnvelope[]> {
    const timeout = this.isFirstPoll ? 8000 : 5000;
    this.isFirstPoll = false;
    const params = new URLSearchParams();
    if (since) { params.set('since', since); }
    const url = `/channels/${this.channelId}/reports${params.toString() ? '?' + params.toString() : ''}`;
    const res = await this.doFetch(url, { timeout });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    const data = await res.json() as { reports?: ReportEnvelope[] } | ReportEnvelope[];
    return (data as { reports?: ReportEnvelope[] }).reports ?? (data as ReportEnvelope[]);
  }

  /** Fetch a single report by ID. */
  async getReport(reportId: string): Promise<ReportEnvelope> {
    const res = await this.doFetch(`/channels/${this.channelId}/reports/${reportId}`, { timeout: 5000 });
    if (!res.ok) { throw new RelayError(res.status, await res.text()); }
    return res.json() as Promise<ReportEnvelope>;
  }

  /** Post a message to the agent. */
  async postMessage(text: string): Promise<void> {
    const payload = { direction: 'to_agent', body: { text, sentAt: new Date().toISOString() } };
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
    return data.channelId ?? data.id ?? '';
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
