import type {
  PaperclipCompany,
  PaperclipAgent,
  PaperclipTaskSession,
  PaperclipCostEntry,
  PaperclipActivity,
  PaperclipPaginatedResponse,
} from './types.js';

export class PaperclipApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
  ) {
    super(`Paperclip API error ${status} on ${path}: ${message}`);
    this.name = 'PaperclipApiError';
  }
}

export class PaperclipClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(serverUrl: string, apiKey: string) {
    this.base = serverUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
  }

  /** Validate credentials and list available companies */
  async getCompanies(): Promise<PaperclipCompany[]> {
    return this.getAll<PaperclipCompany>('/api/companies');
  }

  /** List all agents for a company */
  async getAgents(companyId: string): Promise<PaperclipAgent[]> {
    return this.getAll<PaperclipAgent>(`/api/companies/${companyId}/agents`);
  }

  /** Get task sessions (runs) for an agent since a timestamp. Paginates internally. */
  async getTaskSessions(agentId: string, since: Date): Promise<PaperclipTaskSession[]> {
    const params: Record<string, string> = {
      since: since.toISOString(),
    };
    return this.getAll<PaperclipTaskSession>(`/api/agents/${agentId}/task-sessions`, params);
  }

  /** Get per-agent cost data for a date range (fallback enrichment per D-03) */
  async getCostsByAgent(companyId: string, from: Date, to: Date): Promise<PaperclipCostEntry[]> {
    const params: Record<string, string> = {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
    return this.getAll<PaperclipCostEntry>(`/api/companies/${companyId}/costs/by-agent`, params);
  }

  /** Get activity/audit trail for an agent */
  async getActivity(companyId: string, agentId: string, since: Date): Promise<PaperclipActivity[]> {
    const params: Record<string, string> = {
      agentId,
      since: since.toISOString(),
    };
    return this.getAll<PaperclipActivity>(`/api/companies/${companyId}/activity`, params);
  }

  /**
   * Generic paginated GET: fetches all pages and returns a flat array.
   * Pagination uses cursor-based approach: ?cursor=<nextCursor>
   */
  private async getAll<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;

    do {
      const url = new URL(`${this.base}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      }
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), { method: 'GET', headers: this.headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new PaperclipApiError(res.status, path, body);
      }

      const page = (await res.json()) as PaperclipPaginatedResponse<T>;
      results.push(...page.data);
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor);

    return results;
  }
}
