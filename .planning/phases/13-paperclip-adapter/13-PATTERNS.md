# Phase 13 Patterns: Paperclip Adapter

**Created:** 2026-04-23
**Phase:** 13 — Paperclip Adapter

---

## File List

| File | Role | Analog |
|------|------|--------|
| `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` | **Modified** — replace stub body with real implementation | Itself (stub to promote) |
| `packages/harnesstune-collector/src/plugins/paperclip/client.ts` | **New** — PaperclipClient HTTP abstraction | `packages/harnesstune-collector/src/client.ts` |
| `packages/harnesstune-collector/src/plugins/paperclip/types.ts` | **New** — Paperclip API response shapes | `packages/harnesstune-collector/src/types.ts` |
| `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts` | **New** — Map Paperclip API types → AgentIdentity / RunReport | No direct analog; inline in plugin |
| `packages/harnesstune-collector/src/plugins/loader.ts` | **Not modified** — already imports from stubs path; stub file is promoted in-place | — |

> The stub file at `plugins/stubs/paperclip.ts` is promoted in-place. The loader import path does not change. New supporting files are placed in a `plugins/paperclip/` subdirectory.

---

## Per-File Patterns

---

### 1. `plugins/stubs/paperclip.ts` — Promoted Plugin

**Role:** Replace stub `discover()` and `collectRuns()` with real implementations. Extend `setup()` to call `getCompanies()` and store `companyId`.

**Analog:** The stub itself plus the `ClaudeDesktopPlugin` stub for the setup pattern. Both stubs share the same structure — the promotion only fills in the three currently-empty methods and augments `setup()`.

**Pattern to replicate — class skeleton (from existing stub):**

```typescript
// packages/harnesstune-collector/src/plugins/stubs/paperclip.ts (current stub)
export class PaperclipPlugin implements PlatformPlugin {
  readonly id = 'paperclip';
  readonly displayName = 'Paperclip';

  async detect(): Promise<boolean> { /* filesystem markers — keep as-is */ }

  async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
    // Extend: after prompting for serverUrl + apiKey, call client.getCompanies()
    // to validate credentials and resolve companyId (D-02)
  }

  async discover(): Promise<AgentIdentity[]> {
    // Replace stub: call client.getAgents(companyId) → map to AgentIdentity[]
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    // Replace stub: call client.getTaskSessions(agentId, since) → map to RunReport[]
  }
}
```

**Pattern to replicate — config reading within a method:**

The plugin receives its `PlatformConfig` (a `Record<string, unknown>`) from the scheduler. It must read fields with type assertions:

```typescript
// Pattern from stub setup() — same cast approach applies to discover()/collectRuns()
const serverUrl = (existing?.['serverUrl'] as string | undefined) ?? '';
const apiKey    = (existing?.['apiKey']    as string | undefined) ?? '';
const companyId = (existing?.['companyId'] as string | undefined) ?? '';
```

The plugin must obtain its own config block from `collector.json`. The scheduler passes the full `CollectorConfig` and the plugin needs only its own `platforms[].config` entry. Look up via:

```typescript
// Pattern from scheduler.ts — how plugin configs are accessed
const enabledIds = new Set(config.platforms.filter(p => p.enabled).map(p => p.id));
// ... plugin.id is used to match; the plugin itself receives no config argument on discover/collectRuns
```

**Important:** `PlatformPlugin.discover()` and `collectRuns(since)` receive no config argument per the locked interface (`interface.ts` lines 36, 43). The plugin must store its config internally (set during `setup()` or injected at construction). The promoted plugin should accept config at construction time or read it from a stored property set during `setup()`.

**Recommended approach — constructor injection** (breaks no interface):

```typescript
export class PaperclipPlugin implements PlatformPlugin {
  readonly id = 'paperclip';
  readonly displayName = 'Paperclip';

  private client?: PaperclipClient;
  private companyId?: string;

  // Config injected when the plugin is enabled; null until setup() completes
  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['serverUrl'] && platformConfig?.['apiKey']) {
      this.client = new PaperclipClient(
        platformConfig['serverUrl'] as string,
        platformConfig['apiKey'] as string,
      );
      this.companyId = platformConfig['companyId'] as string | undefined;
    }
  }
  // ...
}
```

The loader instantiates all plugins before config is read; update `loader.ts` to pass the platform config when constructing `PaperclipPlugin`.

---

### 2. `plugins/paperclip/client.ts` — PaperclipClient

**Role:** Encapsulate all HTTP calls to the Paperclip REST API. No business logic — only fetch, parse, and return typed objects.

**Analog:** `packages/harnesstune-collector/src/client.ts` — the existing `CollectorRelayClient` factory.

**Pattern to replicate — client factory structure:**

```typescript
// packages/harnesstune-collector/src/client.ts
export function createClient(relayUrl: string, token: string): CollectorRelayClient {
  const base = relayUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,   // <-- Bearer auth pattern
    'X-Collector-Version': COLLECTOR_VERSION,
  };

  return {
    async post(path, body) {
      return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    },
    async get(path, params) {
      const url = new URL(`${base}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      }
      return fetch(url.toString(), { method: 'GET', headers });
    },
  };
}
```

**Adapt as a class** (D-01 requires `class PaperclipClient`):

```typescript
// plugins/paperclip/client.ts — shape to implement
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

  async getCompanies(): Promise<PaperclipCompany[]> { /* GET /api/companies */ }
  async getAgents(companyId: string): Promise<PaperclipAgent[]> { /* GET /api/companies/:id/agents */ }
  async getTaskSessions(agentId: string, since: Date): Promise<PaperclipTaskSession[]> { /* paginated */ }
  async getCostsByAgent(companyId: string, from: Date, to: Date): Promise<PaperclipCostEntry[]> { /* fallback */ }
  async getActivity(companyId: string, agentId: string, since: Date): Promise<PaperclipActivity[]> {}
}
```

**Error handling pattern** — follow the relay upload pattern in `scheduler.ts` (lines 84–89): check `res.ok`, throw or return `[]` on non-2xx, let the plugin caller handle it:

```typescript
// scheduler.ts error pattern — replicate for client methods
if (!res.ok) {
  queue.enqueue(config.channelId, envelope);
}
```

In the client, throw a typed error on non-2xx so the plugin's `try/catch` in `scheduler.ts` (lines 100–103) catches it and logs it without crashing the daemon:

```typescript
// scheduler.ts plugin error boundary (lines 100-103)
} catch (err) {
  console.error(`Plugin ${plugin.id} error:`, err);
  pluginSummary[plugin.id] = { enabled: true, agentCount: 0 };
}
```

---

### 3. `plugins/paperclip/types.ts` — Paperclip API Response Types

**Role:** Define assumed Paperclip API response shapes as TypeScript interfaces. These are the raw types returned by `PaperclipClient` before mapping to `AgentIdentity` / `RunReport`.

**Analog:** `packages/harnesstune-collector/src/types.ts` — collector-local type definitions that cannot import from other packages.

**Pattern to replicate:**

```typescript
// packages/harnesstune-collector/src/types.ts — self-contained interface declarations
export interface AgentIdentity {
  agentId: string;
  name: string;
  platform: string;
  schedule: string | null;
  lastRunAt: string | null;
  status: string;
}
```

**Apply to Paperclip types — same pattern, assumed API shapes:**

```typescript
// plugins/paperclip/types.ts
export interface PaperclipCompany {
  id: string;
  name: string;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  schedule?: string;      // cron or null
  lastRunAt?: string;     // ISO 8601
  status?: string;
}

export interface PaperclipTaskSession {
  id: string;
  agentId: string;
  startedAt: string;      // ISO 8601
  finishedAt: string;     // ISO 8601
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
  date: string;           // ISO 8601 date
}

export interface PaperclipActivity {
  id: string;
  agentId: string;
  eventType: string;
  occurredAt: string;     // ISO 8601
  detail?: string;
}
```

---

### 4. `plugins/paperclip/mappers.ts` — Type Mapping Functions

**Role:** Pure functions that convert Paperclip API types to the shared types `AgentIdentity` and `RunReport`. No HTTP calls, no side effects.

**Analog:** No direct analog in the current codebase — other stubs return `[]`. The mapping logic is implicit in the interface contract. Use `RunReport` and `AgentIdentity` field definitions as the specification.

**Source of truth — RunReport (from `packages/shared/src/reports.ts` lines 43–56):**

```typescript
export interface RunReport {
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs: number;
  logExcerpt?: string;
  errorSummary?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  costCents?: number;
}
```

**Source of truth — AgentIdentity (from `packages/harnesstune-collector/src/types.ts`):**

```typescript
export interface AgentIdentity {
  agentId: string;
  name: string;
  platform: string;       // 'paperclip'
  schedule: string | null;
  lastRunAt: string | null;
  status: string;
}
```

**Pattern to follow — mapping function signatures:**

```typescript
// plugins/paperclip/mappers.ts

import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { PaperclipAgent, PaperclipTaskSession, PaperclipCostEntry } from './types.js';

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

export function mapTaskSession(session: PaperclipTaskSession): RunReport {
  const durationMs =
    session.durationMs ??
    new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime();

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
    costCents: session.costCents,  // D-03: prefer per-session cost
  };
}

/** D-03 fallback: enrich runs missing costCents from batch cost data */
export function enrichWithCosts(
  runs: RunReport[],
  costs: PaperclipCostEntry[],
): RunReport[] {
  // Costs are per-agent per-day; match by agentId + date of finishedAt
  const costMap = new Map(costs.map(c => [`${c.agentId}:${c.date}`, c.costCents]));
  return runs.map(r => {
    if (r.costCents != null) return r;
    const date = r.finishedAt.slice(0, 10);  // 'YYYY-MM-DD'
    const cents = costMap.get(`${r.agentId}:${date}`);
    return cents != null ? { ...r, costCents: cents } : r;
  });
}
```

---

### 5. `plugins/loader.ts` — Plugin Constructor Call Update

**Role:** Pass `PlatformConfig` to `PaperclipPlugin` constructor so the plugin can initialize its client with credentials from config.

**Analog:** Itself — the change is minimal (one line).

**Current pattern (lines 12–17):**

```typescript
// packages/harnesstune-collector/src/plugins/loader.ts
export const ALL_PLUGINS: PlatformPlugin[] = [
  new PaperclipPlugin(),           // <-- no config today
  new ClaudeDesktopPlugin(),
  new ClaudeCodePlugin(),
  new OpenClawPlugin(),
];
```

**Updated pattern — pass platform config at construction:**

```typescript
import { readConfig } from '../config.js';

function buildPlugins(): PlatformPlugin[] {
  let platformConfigs: Record<string, Record<string, unknown>> = {};
  try {
    const cfg = readConfig();
    for (const p of cfg.platforms) platformConfigs[p.id] = p.config;
  } catch {
    // Config not yet written (pre-setup); plugins get empty config
  }
  return [
    new PaperclipPlugin(platformConfigs['paperclip']),
    new ClaudeDesktopPlugin(),
    new ClaudeCodePlugin(),
    new OpenClawPlugin(),
  ];
}

export const ALL_PLUGINS: PlatformPlugin[] = buildPlugins();
```

---

## Data Flow Diagram

```
~/.harnesstune/collector.json
  platforms[{ id: 'paperclip', enabled: true, config: { serverUrl, apiKey, companyId } }]
         |
         v
  plugins/loader.ts  getAllPlugins()
    └── new PaperclipPlugin(platformConfig)
              |
              | constructor
              v
        PaperclipClient(serverUrl, apiKey)   ← plugins/paperclip/client.ts


  daemon/scheduler.ts  runCycle(plugins, config, queue, cursors)
         |
         |── plugin.discover()
         |     └── client.getAgents(companyId)
         |           └── mapAgent(agent) → AgentIdentity[]
         |               └── POST relay /api/channels/:id/agents  [register]
         |
         |── plugin.collectRuns(since)        [since = cursors['paperclip'] ?? now-7d]
         |     └── client.getTaskSessions(agentId, since)   [paginated, all agents]
         |           └── mapTaskSession(session) → RunReport[]
         |               └── [if costCents missing] enrichWithCosts(runs, costs)
         |                     └── client.getCostsByAgent(companyId, from, to)   [fallback]
         |
         └── for each RunReport:
               POST relay /api/channels/:id/reports  { type: 'run_batch', body: { runs: [run] } }
               └── on failure: queue.enqueue(channelId, envelope)   [RetryQueue disk persist]

  cursors['paperclip'] = max(run.finishedAt)  ← advanced on success; persists across cycles
```

---

## Key Constraints

| Constraint | Source | Implication |
|------------|--------|-------------|
| `PlatformPlugin` interface is locked | `interface.ts`, Phase 12 D-03 | `discover()` and `collectRuns(since)` receive no config argument; config must be stored on the instance |
| Plugin is a pure data source | Phase 12 D-03 | No internal loops, no file watchers, no state between calls |
| Cursor default = now minus 7 days | `scheduler.ts` line 64 | No special backfill logic in plugin; `collectRuns(since)` with old timestamp is sufficient |
| Cost priority: per-session first, batch fallback | Phase 13 D-03 | `mapTaskSession` sets `costCents` from session fields; `enrichWithCosts` only patches nulls |
| Config stored at `~/.harnesstune/collector.json` chmod 600 | `config.ts` lines 54–58 | Client holds `apiKey` in memory only; no additional secrets file needed |
| Auth: Bearer token in `Authorization` header | Phase 13 D-01 | Matches existing relay client pattern in `client.ts` line 13 |
| Pagination handled inside client | Phase 13 D-05 | `getTaskSessions()` returns a flat array; plugin and scheduler see no pagination |
| `companyId` written to config during `setup()` | Phase 13 D-02 | `discover()` and `collectRuns()` read `this.companyId` — must be set before daemon starts |
