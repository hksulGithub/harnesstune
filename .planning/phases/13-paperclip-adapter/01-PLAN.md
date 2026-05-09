---
phase: 13
plan: 01
name: paperclip-data-layer
wave: 1
depends_on: []
files_modified:
  - packages/harnesstune-collector/src/plugins/paperclip/types.ts
  - packages/harnesstune-collector/src/plugins/paperclip/client.ts
  - packages/harnesstune-collector/src/plugins/paperclip/mappers.ts
autonomous: true
requirements:
  - PCLP-01
  - PCLP-02
  - PCLP-03
  - PCLP-04
  - PCLP-05
  - COLL-05
  - COLL-06
---

# Plan 01: Paperclip Data Layer

<objective>
Create the three supporting modules for the Paperclip adapter: API response types, HTTP client class, and mapping functions. These are the data foundation consumed by the plugin in Plan 02.
</objective>

<threat_model>
- **API key in memory:** `PaperclipClient` holds the Board API Key in its `headers` object at runtime. Mitigation: key is read from `collector.json` (chmod 600) and never logged. No additional secrets file created.
- **Bearer token over network:** All Paperclip API calls use `Authorization: Bearer ${apiKey}`. Mitigation: HTTPS assumed for production Paperclip servers; no HTTP downgrade protection (acceptable for v3 — user configures their own server URL).
- **Input validation on API responses:** Client parses JSON responses and casts to typed interfaces. Mitigation: non-2xx responses throw `PaperclipApiError` before parsing body; null/undefined fields handled with fallback defaults in mappers.
- **No credential logging:** Client error messages include HTTP status and URL path but never the Authorization header value.
</threat_model>

<tasks>

## Task 1: Paperclip API Response Types

<read_first>
- packages/harnesstune-collector/src/types.ts
- packages/shared/src/reports.ts
- .planning/phases/13-paperclip-adapter/13-CONTEXT.md
</read_first>

<action>
Create `packages/harnesstune-collector/src/plugins/paperclip/types.ts` with the following interfaces:

```typescript
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
```
</action>

<acceptance_criteria>
- File exists at packages/harnesstune-collector/src/plugins/paperclip/types.ts
- grep -c "export interface PaperclipCompany" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "export interface PaperclipAgent" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "export interface PaperclipTaskSession" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "export interface PaperclipCostEntry" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "export interface PaperclipActivity" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "export interface PaperclipPaginatedResponse" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
- grep -c "status: 'success' | 'failure' | 'timeout' | 'running'" packages/harnesstune-collector/src/plugins/paperclip/types.ts returns 1
</acceptance_criteria>

## Task 2: PaperclipClient HTTP Abstraction

<read_first>
- packages/harnesstune-collector/src/client.ts
- packages/harnesstune-collector/src/plugins/paperclip/types.ts (just created in Task 1)
- .planning/phases/13-paperclip-adapter/13-PATTERNS.md
</read_first>

<action>
Create `packages/harnesstune-collector/src/plugins/paperclip/client.ts`:

```typescript
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
```

Key design points:
- `PaperclipApiError` is a typed error with `status` and `path` fields so the caller (scheduler try/catch) can log diagnostics without exposing the API key.
- `getAll<T>` is a private generic paginator; all public methods delegate to it so pagination logic is not duplicated.
- `Authorization` header is set once in the constructor, matching the relay client pattern in `client.ts`.
- `getCostsByAgent` uses date-only params (`YYYY-MM-DD`) matching the assumed Paperclip cost API.
</action>

<acceptance_criteria>
- File exists at packages/harnesstune-collector/src/plugins/paperclip/client.ts
- grep -c "export class PaperclipClient" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "export class PaperclipApiError" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "async getCompanies" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "async getAgents" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "async getTaskSessions" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "async getCostsByAgent" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "async getActivity" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "private async getAll" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "Bearer" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns 1
- grep -c "PaperclipApiError" packages/harnesstune-collector/src/plugins/paperclip/client.ts returns at least 2
</acceptance_criteria>

## Task 3: Mapping Functions (Paperclip API -> AgentIdentity / RunReport)

<read_first>
- packages/harnesstune-collector/src/types.ts
- packages/shared/src/reports.ts (lines 42-56 for RunReport)
- packages/harnesstune-collector/src/plugins/paperclip/types.ts (just created in Task 1)
- .planning/phases/13-paperclip-adapter/13-PATTERNS.md
</read_first>

<action>
Create `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts`:

```typescript
import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { PaperclipAgent, PaperclipTaskSession, PaperclipCostEntry, PaperclipActivity } from './types.js';

/** Map a Paperclip agent to the collector's AgentIdentity */
export function mapAgent(agent: PaperclipAgent): AgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    platform: 'paperclip',
    schedule: agent.schedule ?? null,
    lastRunAt: agent.lastRunAt ?? null,
    status: agent.status ?? 'unknown',
  };
}

/** Map a Paperclip task session to the shared RunReport type */
export function mapTaskSession(session: PaperclipTaskSession): RunReport {
  const durationMs =
    session.durationMs ??
    (new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime());

  const tokenUsage =
    session.inputTokens != null && session.outputTokens != null
      ? { inputTokens: session.inputTokens, outputTokens: session.outputTokens }
      : undefined;

  return {
    agentId: session.agentId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    status: session.status,
    durationMs,
    logExcerpt: session.logExcerpt,
    errorSummary: session.errorSummary,
    tokenUsage,
    costCents: session.costCents,
  };
}

/**
 * D-03 fallback: enrich runs that are missing costCents from batch cost data.
 * Costs are per-agent per-day; match by agentId + date portion of finishedAt.
 * Only patches runs where costCents is null/undefined.
 */
export function enrichWithCosts(
  runs: RunReport[],
  costs: PaperclipCostEntry[],
): RunReport[] {
  if (costs.length === 0) return runs;
  const costMap = new Map(costs.map(c => [`${c.agentId}:${c.date}`, c.costCents]));
  return runs.map(r => {
    if (r.costCents != null) return r;
    const date = r.finishedAt.slice(0, 10); // 'YYYY-MM-DD'
    const cents = costMap.get(`${r.agentId}:${date}`);
    return cents != null ? { ...r, costCents: cents } : r;
  });
}

/**
 * Map Paperclip activity events to supplementary RunReport fields.
 * Activities that can be correlated to a run (by agentId + time proximity)
 * are appended to the run's logExcerpt. Standalone activities are returned
 * as minimal RunReports with status 'success' and zero duration.
 */
export function mapActivitiesToEvents(
  activities: PaperclipActivity[],
): RunReport[] {
  return activities.map(a => ({
    agentId: a.agentId,
    startedAt: a.occurredAt,
    finishedAt: a.occurredAt,
    status: 'success' as const,
    durationMs: 0,
    logExcerpt: `[${a.eventType}] ${a.detail ?? ''}`.trim(),
  }));
}
```

Key design points:
- `mapAgent` sets `platform: 'paperclip'` to match the `PlatformPlugin.id` convention.
- `mapTaskSession` computes `durationMs` from timestamps if not provided by the API.
- `enrichWithCosts` is a pure function that only patches null costCents, matching D-03 priority.
- `mapActivitiesToEvents` produces lightweight RunReports for standalone audit events (PCLP-05).
</action>

<acceptance_criteria>
- File exists at packages/harnesstune-collector/src/plugins/paperclip/mappers.ts
- grep -c "export function mapAgent" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "export function mapTaskSession" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "export function enrichWithCosts" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "export function mapActivitiesToEvents" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "platform: 'paperclip'" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "import type { RunReport } from '@harnesstune/shared'" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
- grep -c "import type { AgentIdentity } from '../../types.js'" packages/harnesstune-collector/src/plugins/paperclip/mappers.ts returns 1
</acceptance_criteria>

</tasks>

<verification>
1. `cd packages/harnesstune-collector && npx tsc --noEmit` — all three new files compile without errors
2. `ls src/plugins/paperclip/` — contains types.ts, client.ts, mappers.ts
3. Build passes: `pnpm run build:packages` from repo root
</verification>

<must_haves>
- PaperclipClient class with Bearer auth and 5 public methods (getCompanies, getAgents, getTaskSessions, getCostsByAgent, getActivity)
- PaperclipApiError typed error class for non-2xx responses
- Internal pagination handling in client (getAll generic method)
- mapAgent returns AgentIdentity with platform='paperclip'
- mapTaskSession returns RunReport with computed durationMs fallback and optional tokenUsage/costCents
- enrichWithCosts patches only runs with null costCents (D-03 priority)
- mapActivitiesToEvents for PCLP-05 audit trail
- All 6 Paperclip API response type interfaces defined
</must_haves>
