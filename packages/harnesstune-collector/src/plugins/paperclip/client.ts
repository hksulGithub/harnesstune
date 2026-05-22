import type {
  PaperclipCompany,
  PaperclipAgent,
  PaperclipTaskDefinition,
  PaperclipHeartbeatRun,
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

  /** Get task definitions for an agent. Prefer the canonical endpoint, then fall back. */
  async getTaskDefinitions(companyId: string, agentId: string): Promise<PaperclipTaskDefinition[]> {
    const params: Record<string, string> = {
      agentId,
    };
    try {
      return await this.getAll<PaperclipTaskDefinition>(
        `/api/companies/${companyId}/task-definitions`,
        params,
      );
    } catch (error) {
      if (error instanceof PaperclipApiError && error.status === 404) {
        return this.getAll<PaperclipTaskDefinition>(
          `/api/companies/${companyId}/task-sessions`,
          params,
        );
      }
      throw error;
    }
  }

  /** Get heartbeat run executions for an agent since a timestamp. Paginates internally. */
  async getHeartbeatRuns(
    companyId: string,
    agentId: string,
    since: Date,
  ): Promise<PaperclipHeartbeatRun[]> {
    const params: Record<string, string> = {
      agentId,
      since: since.toISOString(),
    };
    return this.getAll<PaperclipHeartbeatRun>(`/api/companies/${companyId}/heartbeat-runs`, params);
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
   * Generic GET that tolerates two response shapes:
   *   1. Raw array `[...]` — typical of the local Paperclip dev server (no pagination).
   *   2. Cursor envelope `{ data: T[], hasMore?: boolean, nextCursor?: string }` — for
   *      deployments that paginate. We follow the cursor until exhausted.
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

      const payload = (await res.json()) as T[] | PaperclipPaginatedResponse<T>;

      if (Array.isArray(payload)) {
        results.push(...payload);
        cursor = undefined;
      } else if (payload && Array.isArray(payload.data)) {
        results.push(...payload.data);
        cursor = payload.hasMore ? payload.nextCursor : undefined;
      } else {
        throw new PaperclipApiError(
          200,
          path,
          `Unexpected response shape: expected array or { data: [...] }, got ${typeof payload}`,
        );
      }
    } while (cursor);

    return results;
  }
}
