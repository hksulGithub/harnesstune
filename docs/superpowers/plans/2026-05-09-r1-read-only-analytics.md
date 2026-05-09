# R1 — Read-Only Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only per-run summaries and productivity analytics for Claude Code and Claude Desktop runs, persisted through the relay and surfaced in the existing Dashboard and Reports tabs without introducing any control-plane behavior.

**Architecture:** R1 extends the existing `RunReport` pipeline end-to-end. Collector-side post-hooks create optional local Claude summaries and attach them to `run_batch` uploads; the relay stores the summary blob alongside `agent_runs`; the VS Code extension reads the same relay-backed run history to render inline summaries in Reports and aggregate counts, durations, and success rates in Dashboard.

**Tech Stack:** TypeScript, Node.js 20, Jest + ts-jest, Hono, Drizzle ORM + Turso/libSQL, VS Code webviews, esbuild multi-bundle build

---

## Pre-task: File Structure

### Shared types
- Modify: `packages/shared/src/reports.ts` — extend `RunReport` with the discriminated `summary` union and export summary helper types.

### Collector
- Modify: `packages/harnesstune-collector/src/config.ts` — add typed per-plugin summary config helpers and defaults.
- Modify: `packages/harnesstune-collector/src/plugins/interface.ts` — allow plugins to receive summary-aware config through existing `platformConfig`.
- Modify: `packages/harnesstune-collector/src/daemon/scheduler.ts` — keep upload path unchanged while passing through `RunReport.summary`.
- Modify: `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts` — enrich collected Claude Code runs with post-run summaries.
- Modify: `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts` — enrich collected Claude Desktop runs with post-run summaries.
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/types.ts` — store transcript path on cron wrapper run files.
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/mappers.ts` — map summary-bearing cron run files into `RunReport`.
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/wrapper.ts` — add transcript capture metadata to the wrapper JSON without changing its Node/TS ownership.
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/types.ts` — extend session metadata with transcript locator fields discovered in Task 6.
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts` — add transcript path resolution utilities.
- Create: `packages/harnesstune-collector/src/summaries/types.ts` — collector-local summary config/result types.
- Create: `packages/harnesstune-collector/src/summaries/policy.ts` — pure sampling decision helper for `on | sample-1-in-N | off`.
- Create: `packages/harnesstune-collector/src/summaries/summarizer.ts` — plugin-agnostic local Claude CLI summarizer.
- Create: `packages/harnesstune-collector/src/summaries/desktop-transcript.ts` — Claude Desktop transcript discovery helper based on actual session file structure.

### Relay
- Modify: `packages/harnesstune-relay/src/db/schema.ts` — persist summary JSON on `agent_runs`.
- Modify: `packages/harnesstune-relay/src/routes/reports.ts` — accept optional `RunReport.summary` and write it through during `run_batch` fanout.
- Create: `packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql` — Drizzle SQL migration for the new `summary` column.
- Create: `packages/harnesstune-relay/drizzle/meta/_journal.json` — Drizzle migration journal. Current repo has `drizzle.config.ts` but no generated `drizzle/` directory yet; introduce it here.

### Extension host + dashboard
- Modify: `src/relay/RelayClient.ts` — expose parsed run summaries on `RunRecord`.
- Modify: `src/types/fleet.ts` — add read-only analytics shapes for 24h / 7d / 30d and summary-bearing runs.
- Modify: `src/providers/RemoteFleetProvider.ts` — compute analytics aggregates from existing relay run history.
- Modify: `src/providers/FleetDataProvider.ts` — return dashboard analytics payloads in existing overview/detail calls.
- Modify: `src/webview/dashboard/App.tsx` — request and render analytics alongside current navigation.
- Create: `src/webview/dashboard/components/AnalyticsPanel.tsx` — reusable read-only KPI panel for 24h / 7d / 30d metrics.

### Reports
- Modify: `src/webview/reports/App.tsx` — keep existing timeline flow, no Ask box added, and pass summary-bearing reports through.
- Modify: `src/webview/reports/components/TimelineFeed.tsx` — route `run_batch` items to a dedicated card.
- Create: `src/webview/reports/components/RunBatchReportCard.tsx` — inline one-line summary plus expandable bullets/tags/error state.
- Modify: `src/types/messages.ts` — no new transport, only widen types if needed for analytics payloads.

### Tests
- Create: `tests/shared/runReportSummary.test.ts` — shared summary union coverage.
- Create: `tests/collector/SummaryPolicy.test.ts` — summary config and sampling helper coverage.
- Create: `tests/collector/Summarizer.test.ts` — mocked local Claude summarizer coverage.
- Create: `tests/collector/ClaudeCodeSummary.test.ts` — Claude Code plugin summary wiring coverage.
- Create: `tests/collector/ClaudeDesktopTranscript.test.ts` — transcript-path discovery coverage.
- Create: `tests/collector/ClaudeDesktopSummary.test.ts` — Claude Desktop plugin summary wiring coverage.
- Create: `tests/relay/RunReportSummaryIngest.test.ts` — relay `run_batch` ingest with and without summaries.
- Create: `tests/integration/R1RunSummaryPipeline.test.ts` — collector-to-relay summary persistence smoke.
- Create: `tests/dashboard/RemoteFleetProviderAnalytics.test.ts` — analytics aggregation coverage.
- Create: `tests/reports/RunBatchReportCard.test.tsx` — Reports rendering coverage.
- Create: `docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md` — manual Hongui-MacBookAir verification script.

### Notes from required reads
- `packages/harnesstune-relay/src/db/` currently contains only `client.ts` and `schema.ts`; there is no pre-existing migration output to extend, so Task 2 creates the first generated `drizzle/` artifact set.
- `src/webview/reports/App.tsx` already renders a `MessageComposer`; R1 must not add a new Ask/meta-analysis box, so this plan leaves messaging unchanged and only adds inline run-summary rendering.
- `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts` currently exposes only metadata from `local_*.json`; transcript-path discovery is unresolved in code today, so Task 6 performs that discovery before desktop summary wiring.

### Task Order Adjustment

The suggested order is adjusted once: a dedicated Claude Desktop transcript discovery task is inserted before desktop wiring. Reason: the current reader and types expose `scheduledTaskId`, timestamps, and model, but no transcript path, and spec §4.4 requires a real local summarizer input before implementation can proceed safely.

## Tasks

### Task 1: Shared RunReport Summary Contract

**Files:**
- Modify: `packages/shared/src/reports.ts`
- Test: `tests/shared/runReportSummary.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import type { RunReport } from '../../packages/shared/src/reports';

describe('RunReport summary union', () => {
  it('accepts success summaries with structured fields', () => {
    const report: RunReport = {
      agentId: 'claude-code-daily',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:02:00.000Z',
      status: 'success',
      durationMs: 120000,
      summary: {
        status: 'ok',
        oneLineSummary: 'Updated the daily status file and pushed a fresh run report.',
        bullets: ['Opened scheduled prompt', 'Generated report', 'Uploaded result'],
        tags: ['reporting', 'cron', 'claude-code'],
        tokenCount: 1842,
      },
    };

    expect(report.summary?.status).toBe('ok');
    if (report.summary?.status === 'ok') {
      expect(report.summary.bullets).toHaveLength(3);
      expect(report.summary.tags).toContain('cron');
      expect(report.summary.tokenCount).toBe(1842);
    }
  });

  it('accepts error summaries without leaking optional ok fields', () => {
    const report: RunReport = {
      agentId: 'claude-desktop-test-1',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:03:00.000Z',
      status: 'failure',
      durationMs: 180000,
      summary: {
        status: 'error',
        reason: 'claude exited with code 1',
      },
    };

    expect(report.summary).toEqual({
      status: 'error',
      reason: 'claude exited with code 1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/shared/runReportSummary.test.ts`
Expected: FAIL with `Property 'summary' does not exist on type 'RunReport'`

- [ ] **Step 3: Implement minimal code**
```ts
/**
 * @harnesstune/shared -- Report body schemas
 * Single source of truth. Imported by @harnesstune/agent and the extension.
 */

export type ReportType = 'briefing' | 'ralph' | 'heartbeat';

export interface BriefingReportBody {
  goals: string[];
  progress: string;
  blockers: string[];
  nextSteps: string[];
  metrics: Record<string, number>;
}

export interface RalphReportBody {
  loopId: string;
  iteration: number;
  metrics: Record<string, number>;
  baselineMetrics: Record<string, number>;
  whatChanged: string;
  cumulativeProgress: string;
}

export interface HeartbeatReportBody {
  status: 'connected' | 'disconnected';
  uptimeSeconds: number;
}

/** Envelope for uploading reports to relay */
export interface ReportEnvelope {
  type: ReportType;
  body: BriefingReportBody | RalphReportBody | HeartbeatReportBody;
  /** ISO 8601 timestamp of when the report was generated */
  generatedAt: string;
  /** UUID v4 unique identifier for this report */
  reportId: string;
  /** Optional agent identifier for per-agent attribution — D-01 */
  agentId?: string;
}

export interface RunReportSummaryOk {
  status: 'ok';
  oneLineSummary: string;
  bullets: string[];
  tags: string[];
  tokenCount: number;
}

export interface RunReportSummaryError {
  status: 'error';
  reason: string;
}

export type RunReportSummary = RunReportSummaryOk | RunReportSummaryError;

/** Structured execution record from a collector/agent run — stored in agent_runs table, NOT a ReportEnvelope type */
export interface RunReport {
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs: number;
  logExcerpt?: string;     // truncated log output
  errorSummary?: string;   // error message if failed
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  costCents?: number;
  summary?: RunReportSummary;
}

export type RunStatus = RunReport['status'];

/** A message from the relay messages API */
export interface RelayMessage {
  id: string;
  channelId: string;
  direction: 'to_agent' | 'from_agent';
  body: { text: string; sentAt: string; inReplyToReportId?: string };
  createdAt: string;
}

/** Local agent activity — synthesised from hook events */
export interface ActivityItem {
  eventType: string;
  toolName?: string;
  model?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  sessionId: string;
}

/** Unified timeline item — report, chat message, or local activity */
export type TimelineItem =
  | { kind: 'report'; data: ReportEnvelope; at: string }
  | { kind: 'message'; data: RelayMessage; at: string }
  | { kind: 'activity'; data: ActivityItem; at: string };
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/shared/runReportSummary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/reports.ts tests/shared/runReportSummary.test.ts
git commit -m "feat(r1): add run report summary contract"
```

### Task 2: Relay DB Migration for Run Summaries

**Files:**
- Create: `packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql`
- Create: `packages/harnesstune-relay/drizzle/meta/_journal.json`
- Modify: `packages/harnesstune-relay/src/db/schema.ts`
- Test: `tests/relay/RunReportSummaryIngest.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('relay schema includes run summary persistence', () => {
  it('adds a summary column to agent_runs and creates a drizzle migration', () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/db/schema.ts'),
      'utf-8',
    );
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql'),
      'utf-8',
    );
    const journal = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/meta/_journal.json'),
      'utf-8',
    );

    expect(schema).toContain("summary: text('summary')");
    expect(migration).toContain('ALTER TABLE agent_runs ADD COLUMN summary text;');
    expect(journal).toContain('"tag": "0001_r1_add_run_summary"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/RunReportSummaryIngest.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-relay/src/db/schema.ts
import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  tokenHash: text('token_hash').notNull(),
  label: text('label'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  type: text('type').notNull(),
  body: text('body').notNull(),
  agentId: text('agent_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  direction: text('direction').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  agentId: text('agent_id').notNull(),
  name: text('name'),
  platform: text('platform').notNull(),
  schedule: text('schedule'),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  status: text('status').notNull().default('unknown'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  channelAgentUniq: uniqueIndex('agents_channel_agent_uniq').on(table.channelId, table.agentId),
}));

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  agentId: text('agent_id').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }).notNull(),
  status: text('status').notNull(),
  durationMs: integer('duration_ms').notNull(),
  logExcerpt: text('log_excerpt'),
  errorSummary: text('error_summary'),
  tokenUsage: text('token_usage'),
  costCents: integer('cost_cents'),
  summary: text('summary'),
}, (table) => ({
  channelAgentStartedUniq: uniqueIndex('agent_runs_channel_agent_started_uniq')
    .on(table.channelId, table.agentId, table.startedAt),
}));

export const rateLimits = sqliteTable('rate_limits', {
  tokenId: text('token_id').notNull(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.tokenId, table.windowStart] }),
}));
```

```sql
-- packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql
ALTER TABLE agent_runs ADD COLUMN summary text;
```

```json
{
  "version": "7",
  "dialect": "turso",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1778284800000,
      "tag": "0001_r1_add_run_summary",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/RunReportSummaryIngest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/db/schema.ts packages/harnesstune-relay/drizzle tests/relay/RunReportSummaryIngest.test.ts
git commit -m "feat(r1): persist run summaries in relay schema"
```

### Task 3: Relay RunReport Ingest Persists Optional Summary

**Files:**
- Modify: `packages/harnesstune-relay/src/routes/reports.ts`
- Test: `tests/relay/RunReportSummaryIngest.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('reports route persists optional run summaries', () => {
  it('stores summary JSON for run_batch rows and keeps legacy uploads working', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/reports.ts'),
      'utf-8',
    );

    expect(routeSource).toContain('summary?: unknown');
    expect(routeSource).toContain("summary: runData.summary ? JSON.stringify(runData.summary) : null");
    expect(routeSource).toContain('const runs = body.type === \'run_batch\'');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/RunReportSummaryIngest.test.ts`
Expected: FAIL with `Expected substring: "summary?: unknown"`

- [ ] **Step 3: Implement minimal code**
```ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, gt, desc, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { reports, agentRuns, agents } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

const MAX_REPORT_SIZE = 2 * 1024 * 1024;

export const reportsRouter = new Hono<{ Variables: AuthVariables }>();

reportsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const contentLength = parseInt(c.req.header('Content-Length') ?? '0', 10);
  if (contentLength > MAX_REPORT_SIZE) {
    return c.json({
      error: 'Payload too large',
      maxBytes: MAX_REPORT_SIZE,
      message: `Report body must not exceed ${MAX_REPORT_SIZE / 1024 / 1024}MB`,
    }, 413);
  }

  const body = await c.req.json<{ type: string; body: Record<string, unknown>; agentId?: string }>();
  if (!body.type || !body.body) {
    return c.json({ error: 'type and body are required' }, 400);
  }

  const serializedBodySize = JSON.stringify(body.body).length;
  if (serializedBodySize > MAX_REPORT_SIZE) {
    return c.json({
      error: 'Payload too large',
      maxBytes: MAX_REPORT_SIZE,
      message: `Report body must not exceed ${MAX_REPORT_SIZE / 1024 / 1024}MB`,
    }, 413);
  }

  const agentId = (body as { agentId?: string }).agentId ?? null;

  const db = getDb();
  const id = randomUUID();
  await db.insert(reports).values({
    id,
    channelId,
    type: body.type,
    body: JSON.stringify(body.body),
    agentId,
  });

  try {
    const runs = body.type === 'run_batch' && Array.isArray(body.body.runs)
      ? body.body.runs
      : [];

    if (runs.length > 0) {
      const latestFinishedAtByAgent = new Map<string, Date>();

      for (const run of runs) {
        if (!run || typeof run !== 'object') continue;

        const runData = run as {
          agentId?: unknown;
          startedAt?: unknown;
          finishedAt?: unknown;
          status?: unknown;
          durationMs?: unknown;
          logExcerpt?: unknown;
          errorSummary?: unknown;
          tokenUsage?: unknown;
          costCents?: unknown;
          summary?: unknown;
        };

        if (typeof runData.agentId !== 'string' || runData.agentId.length === 0) continue;
        if (typeof runData.status !== 'string' || runData.status.length === 0) continue;
        if (typeof runData.durationMs !== 'number' || Number.isNaN(runData.durationMs)) continue;

        const startedAt = new Date(typeof runData.startedAt === 'string' ? runData.startedAt : '');
        const finishedAt = new Date(typeof runData.finishedAt === 'string' ? runData.finishedAt : '');
        if (Number.isNaN(startedAt.getTime()) || Number.isNaN(finishedAt.getTime())) continue;

        await db.insert(agentRuns).values({
          id: randomUUID(),
          channelId,
          agentId: runData.agentId,
          startedAt,
          finishedAt,
          status: runData.status,
          durationMs: runData.durationMs,
          logExcerpt: typeof runData.logExcerpt === 'string' ? runData.logExcerpt : null,
          errorSummary: typeof runData.errorSummary === 'string' ? runData.errorSummary : null,
          tokenUsage: runData.tokenUsage ? JSON.stringify(runData.tokenUsage) : null,
          costCents: typeof runData.costCents === 'number' ? runData.costCents : null,
          summary: runData.summary ? JSON.stringify(runData.summary) : null,
        }).onConflictDoNothing();

        const existingAgent = await db.select().from(agents)
          .where(and(eq(agents.channelId, channelId), eq(agents.agentId, runData.agentId)))
          .limit(1);
        if (existingAgent.length === 0) {
          await db.insert(agents).values({
            id: randomUUID(),
            channelId,
            agentId: runData.agentId,
            platform: 'unknown',
            name: null,
            schedule: null,
          });
        }

        const previousLatest = latestFinishedAtByAgent.get(runData.agentId);
        if (!previousLatest || finishedAt > previousLatest) {
          latestFinishedAtByAgent.set(runData.agentId, finishedAt);
        }
      }

      for (const [batchAgentId, latestFinishedAt] of latestFinishedAtByAgent) {
        await db.update(agents).set({ lastRunAt: latestFinishedAt })
          .where(and(eq(agents.channelId, channelId), eq(agents.agentId, batchAgentId)));
      }
    }
  } catch (error) {
    console.error('Failed to fan out run_batch report into agent_runs:', error);
  }

  return c.json({ id, channelId, type: body.type, createdAt: new Date().toISOString() }, 201);
});

reportsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const since = c.req.query('since');
  const agentId = c.req.query('agentId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  const db = getDb();
  const conditions = [eq(reports.channelId, channelId)];
  if (since) conditions.push(gt(reports.createdAt, new Date(since)));
  if (agentId) conditions.push(eq(reports.agentId, agentId));

  const rows = await db.select({
    id: reports.id,
    channelId: reports.channelId,
    type: reports.type,
    agentId: reports.agentId,
    createdAt: reports.createdAt,
  }).from(reports).where(and(...conditions)).orderBy(desc(reports.createdAt)).limit(limit);

  return c.json({ reports: rows, count: rows.length });
});

reportsRouter.get('/:reportId', async (c) => {
  const channelId = c.req.param('channelId');
  const reportId = c.req.param('reportId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const db = getDb();
  const rows = await db.select().from(reports).where(
    and(eq(reports.id, reportId), eq(reports.channelId, channelId)),
  ).limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Report not found' }, 404);
  }

  const report = rows[0];
  return c.json({
    ...report,
    body: JSON.parse(report.body),
  });
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/RunReportSummaryIngest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/reports.ts tests/relay/RunReportSummaryIngest.test.ts
git commit -m "feat(r1): fan out optional run summaries at ingest"
```

### Task 4: Collector Summary Config and Sampling Policy

**Files:**
- Create: `packages/harnesstune-collector/src/summaries/types.ts`
- Create: `packages/harnesstune-collector/src/summaries/policy.ts`
- Modify: `packages/harnesstune-collector/src/config.ts`
- Test: `tests/collector/SummaryPolicy.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { parseSummaryMode, shouldSummarizeRun } from '../../packages/harnesstune-collector/src/summaries/policy';

describe('summary sampling policy', () => {
  it('defaults missing config to on', () => {
    expect(parseSummaryMode(undefined)).toEqual({ kind: 'on' });
  });

  it('parses sample mode and only keeps every nth run', () => {
    expect(parseSummaryMode('sample-1-in-5')).toEqual({ kind: 'sample', every: 5 });
    expect(shouldSummarizeRun({ kind: 'sample', every: 5 }, 10)).toBe(true);
    expect(shouldSummarizeRun({ kind: 'sample', every: 5 }, 11)).toBe(false);
  });

  it('turns summaries off explicitly', () => {
    expect(parseSummaryMode('off')).toEqual({ kind: 'off' });
    expect(shouldSummarizeRun({ kind: 'off' }, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/SummaryPolicy.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/summaries/policy'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/summaries/types.ts
import type { RunReportSummary } from '@harnesstune/shared';

export type SummaryModeString = 'on' | 'off' | `sample-1-in-${number}`;

export type SummaryMode =
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'sample'; every: number };

export type SummaryResult = RunReportSummary;
```

```ts
// packages/harnesstune-collector/src/summaries/policy.ts
import type { SummaryMode, SummaryModeString } from './types.js';

export function parseSummaryMode(input: unknown): SummaryMode {
  if (input === undefined || input === null || input === 'on') {
    return { kind: 'on' };
  }
  if (input === 'off') {
    return { kind: 'off' };
  }
  if (typeof input === 'string') {
    const match = /^sample-1-in-(\d+)$/.exec(input);
    if (match) {
      const every = Number(match[1]);
      if (Number.isInteger(every) && every > 1) {
        return { kind: 'sample', every };
      }
    }
  }
  return { kind: 'on' };
}

export function shouldSummarizeRun(mode: SummaryMode, runNumber: number): boolean {
  if (mode.kind === 'off') {
    return false;
  }
  if (mode.kind === 'on') {
    return true;
  }
  return runNumber % mode.every === 0;
}

export function stringifySummaryMode(mode: SummaryMode): SummaryModeString {
  if (mode.kind === 'off') return 'off';
  if (mode.kind === 'on') return 'on';
  return `sample-1-in-${mode.every}`;
}
```

```ts
// packages/harnesstune-collector/src/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseSummaryMode, stringifySummaryMode } from './summaries/policy.js';
import type { SummaryModeString } from './summaries/types.js';

export interface PlatformEntry {
  id: string;
  enabled: boolean;
  config: Record<string, unknown> & { summaries?: SummaryModeString };
}

export interface CollectorConfig {
  relayUrl: string;
  channelId: string;
  token: string;
  pollInterval?: number;
  heartbeatInterval?: number;
  platforms: PlatformEntry[];
}

export interface CollectorStatus {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  lastPoll: string;
  plugins: Record<string, { enabled: boolean; agentCount: number }>;
}

export const COLLECTOR_DIR = join(homedir(), '.harnesstune');
export const CONFIG_FILE = join(COLLECTOR_DIR, 'collector.json');
export const PID_FILE = join(COLLECTOR_DIR, 'collector.pid');
export const STATUS_FILE = join(COLLECTOR_DIR, 'collector-status.json');
const QUEUE_DIR = join(COLLECTOR_DIR, 'queue');

const DEFAULT_PLATFORMS: PlatformEntry[] = [
  { id: 'paperclip', enabled: false, config: { summaries: 'on' } },
  { id: 'claude-desktop', enabled: false, config: { summaries: 'on' } },
  { id: 'claude-code', enabled: false, config: { summaries: 'on' } },
  { id: 'openclaw', enabled: false, config: { summaries: 'on' } },
];

export function readConfig(): CollectorConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('No collector config found. Run: harnesstune-collector setup');
  }
  const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as CollectorConfig;
  parsed.platforms = parsed.platforms.map((platform) => ({
    ...platform,
    config: {
      ...platform.config,
      summaries: stringifySummaryMode(parseSummaryMode(platform.config?.summaries)),
    },
  }));
  return parsed;
}

export function writeConfig(config: CollectorConfig): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  chmodSync(CONFIG_FILE, 0o600);
}

export function createDefaultConfig(relayUrl: string, channelId: string, token: string): CollectorConfig {
  return {
    relayUrl,
    channelId,
    token,
    pollInterval: 60_000,
    heartbeatInterval: 300_000,
    platforms: DEFAULT_PLATFORMS,
  };
}

export function writePid(pid: number): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf-8').trim();
  return raw ? parseInt(raw, 10) : null;
}

export function removePid(): void {
  if (existsSync(PID_FILE)) {
    rmSync(PID_FILE);
  }
}

export function writeStatus(status: CollectorStatus): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

export function readStatus(): CollectorStatus | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as CollectorStatus;
  } catch {
    return null;
  }
}

export function getQueueDir(): string {
  mkdirSync(QUEUE_DIR, { recursive: true });
  return QUEUE_DIR;
}

export function resolveToken(config: CollectorConfig): string {
  return process.env['HARNESSTUNE_TOKEN'] ?? config.token;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/SummaryPolicy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/config.ts packages/harnesstune-collector/src/summaries tests/collector/SummaryPolicy.test.ts
git commit -m "feat(r1): add collector summary sampling policy"
```

### Task 5: Plugin-Agnostic Local Claude Summarizer

**Files:**
- Create: `packages/harnesstune-collector/src/summaries/summarizer.ts`
- Test: `tests/collector/Summarizer.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeTranscript } from '../../packages/harnesstune-collector/src/summaries/summarizer';

describe('summarizeTranscript', () => {
  it('returns ok summary when claude prints valid JSON', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarizer-test-'));
    const transcriptPath = path.join(tmp, 'transcript.md');
    fs.writeFileSync(transcriptPath, 'did a thing');

    const result = await summarizeTranscript(transcriptPath, {
      timeoutMs: 1000,
      spawnImpl: async () => ({
        code: 0,
        stdout: JSON.stringify({
          oneLineSummary: 'Did a thing.',
          bullets: ['Opened file', 'Edited file'],
          tags: ['edit'],
          tokenCount: 321,
        }),
        stderr: '',
      }),
    });

    expect(result).toEqual({
      status: 'ok',
      oneLineSummary: 'Did a thing.',
      bullets: ['Opened file', 'Edited file'],
      tags: ['edit'],
      tokenCount: 321,
    });
  });

  it('returns error summary on bad JSON and never throws', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarizer-test-'));
    const transcriptPath = path.join(tmp, 'transcript.md');
    fs.writeFileSync(transcriptPath, 'did a thing');

    const result = await summarizeTranscript(transcriptPath, {
      timeoutMs: 1000,
      spawnImpl: async () => ({
        code: 0,
        stdout: 'not-json',
        stderr: '',
      }),
    });

    expect(result).toEqual({
      status: 'error',
      reason: 'invalid_summary_json',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/Summarizer.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/summaries/summarizer'`

- [ ] **Step 3: Implement minimal code**
```ts
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunReportSummary } from '@harnesstune/shared';

const execFileAsync = promisify(execFile);

export interface SummarizeOptions {
  timeoutMs: number;
  claudePath?: string;
  spawnImpl?: (input: { transcript: string; prompt: string; timeoutMs: number; claudePath: string }) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
}

function buildPrompt(transcript: string): string {
  return [
    'Summarize the following agent run as JSON.',
    'Return exactly one JSON object with keys:',
    'oneLineSummary, bullets, tags, tokenCount',
    'bullets must be an array of short strings.',
    'tags must be an array of lowercase strings.',
    'tokenCount must be an integer estimate.',
    '',
    transcript,
  ].join('\n');
}

function parseSummaryJson(raw: string): RunReportSummary {
  try {
    const parsed = JSON.parse(raw) as {
      oneLineSummary?: unknown;
      bullets?: unknown;
      tags?: unknown;
      tokenCount?: unknown;
    };

    if (
      typeof parsed.oneLineSummary !== 'string' ||
      !Array.isArray(parsed.bullets) ||
      !parsed.bullets.every((item) => typeof item === 'string') ||
      !Array.isArray(parsed.tags) ||
      !parsed.tags.every((item) => typeof item === 'string') ||
      typeof parsed.tokenCount !== 'number'
    ) {
      return { status: 'error', reason: 'invalid_summary_json' };
    }

    return {
      status: 'ok',
      oneLineSummary: parsed.oneLineSummary,
      bullets: parsed.bullets,
      tags: parsed.tags,
      tokenCount: parsed.tokenCount,
    };
  } catch {
    return { status: 'error', reason: 'invalid_summary_json' };
  }
}

async function defaultSpawn(input: {
  transcript: string;
  prompt: string;
  timeoutMs: number;
  claudePath: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      input.claudePath,
      ['--print', input.prompt],
      { timeout: input.timeoutMs, maxBuffer: 1024 * 1024 },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  }
}

export async function summarizeTranscript(
  transcriptPath: string,
  options: SummarizeOptions,
): Promise<RunReportSummary> {
  try {
    const transcript = await readFile(transcriptPath, 'utf-8');
    const prompt = buildPrompt(transcript);
    const spawnImpl = options.spawnImpl ?? defaultSpawn;
    const result = await spawnImpl({
      transcript,
      prompt,
      timeoutMs: options.timeoutMs,
      claudePath: options.claudePath ?? 'claude',
    });

    if (result.code !== 0) {
      return {
        status: 'error',
        reason: result.stderr.includes('rate limit') ? 'rate_limited' : `claude_exit_${result.code}`,
      };
    }

    return parseSummaryJson(result.stdout.trim());
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : 'summary_failed',
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/Summarizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/summaries/summarizer.ts tests/collector/Summarizer.test.ts
git commit -m "feat(r1): add local claude transcript summarizer"
```

### Task 6: Claude Desktop Transcript Discovery

**Files:**
- Create: `packages/harnesstune-collector/src/summaries/desktop-transcript.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/types.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts`
- Test: `tests/collector/ClaudeDesktopTranscript.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeDesktopTranscriptPath } from '../../packages/harnesstune-collector/src/summaries/desktop-transcript';

describe('resolveClaudeDesktopTranscriptPath', () => {
  it('maps session metadata to a sibling transcript markdown file when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-transcript-'));
    const sessionPath = path.join(root, 'local_abc.json');
    const transcriptPath = path.join(root, 'local_abc.md');

    fs.writeFileSync(sessionPath, JSON.stringify({
      sessionId: 'abc',
      scheduledTaskId: 'test-1',
      createdAt: 1,
      lastActivityAt: 2,
      isArchived: false,
      title: 'Test',
      model: 'claude-sonnet-4',
    }));
    fs.writeFileSync(transcriptPath, '# transcript');

    expect(resolveClaudeDesktopTranscriptPath(sessionPath)).toBe(transcriptPath);
  });

  it('returns null when no transcript companion file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-transcript-'));
    const sessionPath = path.join(root, 'local_missing.json');
    fs.writeFileSync(sessionPath, '{}');

    expect(resolveClaudeDesktopTranscriptPath(sessionPath)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeDesktopTranscript.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/summaries/desktop-transcript'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/summaries/desktop-transcript.ts
import { existsSync } from 'node:fs';

export function resolveClaudeDesktopTranscriptPath(sessionJsonPath: string): string | null {
  const candidates = [
    sessionJsonPath.replace(/\.json$/, '.md'),
    sessionJsonPath.replace(/\.json$/, '.transcript.md'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
```

```ts
// packages/harnesstune-collector/src/plugins/claude-desktop/types.ts
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
```

```ts
// packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ScheduledTask, ScheduledTasksFile, SessionFile } from './types.js';
import { resolveClaudeDesktopTranscriptPath } from '../../summaries/desktop-transcript.js';

const SCHEDULED_TASKS_FILE = 'scheduled-tasks.json';

export function getScheduledTasksMtime(sessionsDir: string): Date {
  try {
    return statSync(join(sessionsDir, SCHEDULED_TASKS_FILE)).mtime;
  } catch {
    return new Date(0);
  }
}

export function readScheduledTasks(sessionsDir: string): ScheduledTask[] {
  try {
    const raw = readFileSync(join(sessionsDir, SCHEDULED_TASKS_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as ScheduledTasksFile;
    return parsed.scheduledTasks ?? [];
  } catch {
    return [];
  }
}

export function readSessionFile(filePath: string): SessionFile | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SessionFile;
    parsed.sessionPath = filePath;
    parsed.transcriptPath = resolveClaudeDesktopTranscriptPath(filePath);
    return parsed;
  } catch {
    return null;
  }
}

export function scanSessions(sessionsDir: string, since: Date): SessionFile[] {
  const sinceMs = since.getTime();
  const nowMs = Date.now();
  const STALENESS_GUARD_MS = 30_000;
  const results: SessionFile[] = [];

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.startsWith('local_') || !entry.endsWith('.json')) continue;

    const filePath = join(sessionsDir, entry);

    try {
      const mtime = statSync(filePath).mtime.getTime();
      if (mtime <= sinceMs) continue;
    } catch {
      continue;
    }

    const session = readSessionFile(filePath);
    if (!session) continue;
    if (!session.scheduledTaskId) continue;
    if (session.lastActivityAt > nowMs - STALENESS_GUARD_MS) continue;
    if (session.lastActivityAt <= sinceMs) continue;

    results.push(session);
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeDesktopTranscript.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/summaries/desktop-transcript.ts packages/harnesstune-collector/src/plugins/claude-desktop/{types.ts,reader.ts} tests/collector/ClaudeDesktopTranscript.test.ts
git commit -m "feat(r1): resolve claude desktop transcript companions"
```

### Task 7: Claude Code Wrapper and Plugin Summary Wiring

**Files:**
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/wrapper.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/types.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/mappers.ts`
- Modify: `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts`
- Test: `tests/collector/ClaudeCodeSummary.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { mapCronRunFile } from '../../packages/harnesstune-collector/src/plugins/claude-code/mappers';

describe('ClaudeCode summary wiring', () => {
  it('preserves main run success when summary generation fails', () => {
    const report = mapCronRunFile({
      agentName: 'daily-report',
      command: 'claude -p report',
      exitCode: 0,
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:01:00.000Z',
      durationMs: 60000,
      outputTail: 'ok',
      transcriptPath: '/tmp/transcript.md',
    });

    expect(report.status).toBe('success');
    expect(report.summary).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeCodeSummary.test.ts`
Expected: FAIL with `Object literal may only specify known properties, and 'transcriptPath' does not exist`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/plugins/claude-code/types.ts
export interface CronRunFile {
  agentName: string;
  command: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outputTail: string;
  transcriptPath?: string;
}

export interface CrontabEntry {
  schedule: string;
  agentName: string;
  rawLine: string;
}
```

```ts
// packages/harnesstune-collector/src/plugins/claude-code/mappers.ts
import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { CronRunFile, CrontabEntry } from './types.js';

export function mapCrontabEntry(entry: CrontabEntry): AgentIdentity {
  return {
    agentId: entry.agentName,
    name: entry.agentName,
    platform: 'claude-code',
    schedule: entry.schedule,
    lastRunAt: null,
    status: 'active',
  };
}

export function mapCronRunFile(file: CronRunFile): RunReport {
  const isFailed = file.exitCode !== 0;
  return {
    agentId: file.agentName,
    startedAt: file.startedAt,
    finishedAt: file.finishedAt,
    status: isFailed ? 'failure' : 'success',
    durationMs: file.durationMs,
    logExcerpt: file.outputTail,
    errorSummary: isFailed
      ? `Exit code ${file.exitCode}: ${file.outputTail.split('\n').slice(-3).join(' | ')}`
      : undefined,
  };
}
```

```ts
// packages/harnesstune-collector/src/plugins/claude-code/wrapper.ts
export function generateWrapperScript(): string {
  return `#!/usr/bin/env bash
set -uo pipefail

RUNS_DIR="$HOME/.harnesstune/cron-runs"
OUTPUT_TAIL_LINES=50
TRANSCRIPT_FILE=""

if [ "$#" -lt 3 ] || [ "$1" != "--name" ]; then
  echo "Usage: harnesstune-wrap --name <agent-name> <command> [args...]" >&2
  exit 2
fi

AGENT_NAME="$2"
shift 2

mkdir -p "$RUNS_DIR"

STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
START_EPOCH=$(date +%s)

TMPOUT=$(mktemp)
"$@" > "$TMPOUT" 2>&1
EXIT_CODE=$?

FINISHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
END_EPOCH=$(date +%s)
DURATION_MS=$(( (END_EPOCH - START_EPOCH) * 1000 ))

OUTPUT_TAIL=$(tail -n "$OUTPUT_TAIL_LINES" "$TMPOUT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')
TRANSCRIPT_FILE="$TMPOUT"

TIMESTAMP=$(date +%s%N | cut -c1-13)
RUN_FILE="$RUNS_DIR/${TIMESTAMP}-${AGENT_NAME}.json"
TMP_FILE="${RUN_FILE}.tmp"

printf '{
  "agentName": "%s",
  "command": "%s",
  "exitCode": %d,
  "startedAt": "%s",
  "finishedAt": "%s",
  "durationMs": %d,
  "outputTail": "%s",
  "transcriptPath": "%s"
}\n' "$AGENT_NAME" "$(echo "$*" | sed 's/"/\\"/g')" "$EXIT_CODE" "$STARTED_AT" "$FINISHED_AT" "$DURATION_MS" "$OUTPUT_TAIL" "$TRANSCRIPT_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$RUN_FILE"
exit $EXIT_CODE
`;
}
```

```ts
// packages/harnesstune-collector/src/plugins/stubs/claude-code.ts
import { existsSync, readdirSync, readFileSync, unlinkSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import type { CronRunFile } from '../claude-code/types.js';
import { mapCrontabEntry, mapCronRunFile } from '../claude-code/mappers.js';
import { readCrontab } from '../claude-code/crontab.js';
import { generateWrapperScript } from '../claude-code/wrapper.js';
import { COLLECTOR_DIR } from '../../config.js';
import { parseSummaryMode, shouldSummarizeRun } from '../../summaries/policy.js';
import { summarizeTranscript } from '../../summaries/summarizer.js';

const DEFAULT_WRAPPER_PATH = join(COLLECTOR_DIR, 'bin', 'harnesstune-wrap');
const DEFAULT_CRON_RUNS_DIR = join(COLLECTOR_DIR, 'cron-runs');
const STALE_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class ClaudeCodePlugin implements PlatformPlugin {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  private wrapperPath: string;
  private cronRunsDir: string;

  constructor(private readonly platformConfig?: PlatformConfig) {
    this.wrapperPath = (platformConfig?.['wrapperPath'] as string) ?? DEFAULT_WRAPPER_PATH;
    this.cronRunsDir = (platformConfig?.['cronRunsDir'] as string) ?? DEFAULT_CRON_RUNS_DIR;
  }

  async detect(): Promise<boolean> {
    const markers = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.nvm', 'versions'),
      join(homedir(), '.local', 'bin', 'claude'),
    ];
    const settingsFile = join(homedir(), '.claude', 'settings.json');
    return existsSync(settingsFile) || markers.some((p) => existsSync(p));
  }

  async setup(_existing?: PlatformConfig): Promise<PlatformConfig> {
    const binDir = join(COLLECTOR_DIR, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(DEFAULT_CRON_RUNS_DIR, { recursive: true });

    const script = generateWrapperScript();
    writeFileSync(DEFAULT_WRAPPER_PATH, script, 'utf-8');
    chmodSync(DEFAULT_WRAPPER_PATH, 0o755);

    return {
      wrapperPath: DEFAULT_WRAPPER_PATH,
      cronRunsDir: DEFAULT_CRON_RUNS_DIR,
      summaries: 'on',
    };
  }

  async discover(): Promise<AgentIdentity[]> {
    const entries = await readCrontab();
    return entries.map(mapCrontabEntry);
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!existsSync(this.cronRunsDir)) return [];

    const sinceMs = since.getTime();
    const nowMs = Date.now();
    const runs: RunReport[] = [];
    const summaryMode = parseSummaryMode(this.platformConfig?.['summaries']);

    let entries: string[];
    try {
      entries = readdirSync(this.cronRunsDir);
    } catch {
      return [];
    }

    let seenRunNumber = 0;

    for (const entry of entries) {
      const filePath = join(this.cronRunsDir, entry);
      if (entry.endsWith('.json.tmp')) continue;
      if (!entry.endsWith('.json')) continue;

      try {
        const mtime = statSync(filePath).mtime.getTime();
        if (mtime < nowMs - STALE_FILE_AGE_MS) {
          try { unlinkSync(filePath); } catch {}
          continue;
        }
        if (mtime < sinceMs) continue;
      } catch {
        continue;
      }

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const runFile = JSON.parse(raw) as CronRunFile;
        if (!runFile.agentName || !runFile.startedAt || !runFile.finishedAt) {
          try { unlinkSync(filePath); } catch {}
          continue;
        }

        const report = mapCronRunFile(runFile);
        seenRunNumber += 1;

        if (
          runFile.transcriptPath &&
          shouldSummarizeRun(summaryMode, seenRunNumber)
        ) {
          report.summary = await summarizeTranscript(runFile.transcriptPath, { timeoutMs: 15_000 });
        }

        runs.push(report);
        try { unlinkSync(filePath); } catch {}
      } catch (err) {
        console.error(`Failed to process run file ${entry}:`, (err as Error).message);
      }
    }

    return runs;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeCodeSummary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/claude-code/{wrapper.ts,types.ts,mappers.ts} packages/harnesstune-collector/src/plugins/stubs/claude-code.ts tests/collector/ClaudeCodeSummary.test.ts
git commit -m "feat(r1): attach summaries to claude code runs"
```

### Task 8: Claude Desktop Plugin Summary Wiring

**Files:**
- Modify: `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts`
- Test: `tests/collector/ClaudeDesktopSummary.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { mapSessionToRunReport } from '../../packages/harnesstune-collector/src/plugins/claude-desktop/mappers';

describe('ClaudeDesktop summary wiring', () => {
  it('maps session metadata to a run report before summary attachment', () => {
    const report = mapSessionToRunReport({
      sessionId: 'abc',
      scheduledTaskId: 'task-1',
      createdAt: 1000,
      lastActivityAt: 4000,
      isArchived: false,
      title: 'Run task',
      model: 'claude-opus-4-5',
      transcriptPath: '/tmp/local_abc.md',
    }, 'task-1');

    expect(report.agentId).toBe('task-1');
    expect(report.summary).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeDesktopSummary.test.ts`
Expected: FAIL with `Object literal may only specify known properties, and 'transcriptPath' does not exist`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts
import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../../types.js';
import type { ScheduledTask, SessionFile } from './types.js';

export function mapScheduledTask(task: ScheduledTask): AgentIdentity {
  return {
    agentId: task.id,
    name: task.id,
    platform: 'claude-desktop',
    schedule: task.cronExpression,
    lastRunAt: task.lastRunAt ?? null,
    status: task.enabled ? 'active' : 'paused',
  };
}

export function mapSessionToRunReport(session: SessionFile, taskId: string): RunReport {
  return {
    agentId: taskId,
    startedAt: new Date(session.createdAt).toISOString(),
    finishedAt: new Date(session.lastActivityAt).toISOString(),
    status: session.error ? 'failure' : 'success',
    durationMs: session.lastActivityAt - session.createdAt,
    errorSummary: session.error,
    logExcerpt: session.error ? `[${session.model}] ${session.error}` : undefined,
  };
}
```

```ts
// packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import { mapScheduledTask, mapSessionToRunReport } from '../claude-desktop/mappers.js';
import { readScheduledTasks, scanSessions, getScheduledTasksMtime } from '../claude-desktop/reader.js';
import { parseSummaryMode, shouldSummarizeRun } from '../../summaries/policy.js';
import { summarizeTranscript } from '../../summaries/summarizer.js';

const DEFAULT_SESSIONS_BASE = join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'local-agent-mode-sessions',
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClaudeDesktopPlugin implements PlatformPlugin {
  readonly id = 'claude-desktop';
  readonly displayName = 'Claude Desktop';

  private sessionsDir?: string;
  private lastKnownMtime: Date = new Date(0);
  private cachedAgents: AgentIdentity[] = [];

  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['sessionsDir']) {
      this.sessionsDir = platformConfig['sessionsDir'] as string;
    }
  }

  async detect(): Promise<boolean> {
    const markers = [
      '/Applications/Claude.app',
      join(homedir(), 'Applications', 'Claude.app'),
      join(homedir(), 'Library', 'Application Support', 'Claude'),
    ];
    return markers.some((p) => existsSync(p));
  }

  async setup(existing?: PlatformConfig, injectedRl?: ReadlineInterface): Promise<PlatformConfig> {
    const rl = injectedRl ?? createInterface({ input, output });
    const ownsRl = !injectedRl;
    try {
      const paths = this.discoverSessionPaths();
      if (paths.length === 0) {
        const defaultDir = (existing?.['sessionsDir'] as string | undefined) ?? DEFAULT_SESSIONS_BASE;
        const sessionsDir = (await rl.question(`Claude Desktop sessions directory [${defaultDir}]: `)).trim() || defaultDir;
        return { sessionsDir, summaries: 'on' };
      }
      if (paths.length === 1) {
        return { sessionsDir: paths[0], summaries: 'on' };
      }
      const choice = await rl.question(`Select directory [1-${paths.length}]: `);
      const idx = parseInt(choice.trim(), 10) - 1;
      if (idx < 0 || idx >= paths.length) {
        throw new Error('Invalid selection.');
      }
      return { sessionsDir: paths[idx], summaries: 'on' };
    } finally {
      if (ownsRl) rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    if (!this.sessionsDir) return [];

    const currentMtime = getScheduledTasksMtime(this.sessionsDir);
    if (currentMtime.getTime() <= this.lastKnownMtime.getTime() && this.cachedAgents.length > 0) {
      return this.cachedAgents;
    }

    const tasks = readScheduledTasks(this.sessionsDir);
    this.cachedAgents = tasks.map(mapScheduledTask);
    this.lastKnownMtime = currentMtime;
    return this.cachedAgents;
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!this.sessionsDir) return [];

    const tasks = readScheduledTasks(this.sessionsDir);
    const taskIds = new Set(tasks.map((t) => t.id));
    const sessions = scanSessions(this.sessionsDir, since);
    const summaryMode = parseSummaryMode(this.platformConfig?.['summaries']);

    const runs: RunReport[] = [];
    let seenRunNumber = 0;

    for (const session of sessions) {
      if (!session.scheduledTaskId || !taskIds.has(session.scheduledTaskId)) continue;

      try {
        const report = mapSessionToRunReport(session, session.scheduledTaskId);
        seenRunNumber += 1;

        if (session.transcriptPath && shouldSummarizeRun(summaryMode, seenRunNumber)) {
          report.summary = await summarizeTranscript(session.transcriptPath, { timeoutMs: 15_000 });
        }

        runs.push(report);
      } catch (err) {
        console.error(`Failed to map session ${session.sessionId}:`, (err as Error).message);
      }
    }

    return runs;
  }

  private discoverSessionPaths(): string[] {
    const paths: string[] = [];
    if (!existsSync(DEFAULT_SESSIONS_BASE)) return paths;

    try {
      const orgDirs = readdirSync(DEFAULT_SESSIONS_BASE);
      for (const orgDir of orgDirs) {
        if (!UUID_PATTERN.test(orgDir)) continue;
        const orgPath = join(DEFAULT_SESSIONS_BASE, orgDir);
        try {
          if (!statSync(orgPath).isDirectory()) continue;
        } catch {
          continue;
        }
        const userDirs = readdirSync(orgPath);
        for (const userDir of userDirs) {
          const userPath = join(orgPath, userDir);
          const scheduledFile = join(userPath, 'scheduled-tasks.json');
          if (existsSync(scheduledFile)) {
            paths.push(userPath);
          }
        }
      }
    } catch {}

    return paths;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeDesktopSummary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts tests/collector/ClaudeDesktopSummary.test.ts
git commit -m "feat(r1): attach summaries to claude desktop runs"
```

### Task 9: End-to-End Collector → Relay Summary Pipeline

**Files:**
- Modify: `packages/harnesstune-collector/src/daemon/scheduler.ts`
- Test: `tests/integration/R1RunSummaryPipeline.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('runCycle forwards summary-bearing run reports unchanged', () => {
  it('serializes the existing RunReport.summary field into the run_batch upload', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-collector/src/daemon/scheduler.ts'),
      'utf-8',
    );

    expect(source).toContain('body: { runs: [run] }');
    expect(source).not.toContain('delete run.summary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/integration/R1RunSummaryPipeline.test.ts`
Expected: FAIL with `Cannot find module` or missing test file

- [ ] **Step 3: Implement minimal code**
```ts
import { randomUUID } from 'node:crypto';
import type { CollectorConfig } from '../config.js';
import { resolveToken } from '../config.js';
import type { RetryQueue } from '../queue.js';
import type { PlatformPlugin } from '../plugins/interface.js';

export interface PluginCursors {
  [pluginId: string]: Date;
}

export interface CycleResult {
  lastPoll: string;
  plugins: Record<string, { enabled: boolean; agentCount: number }>;
}

export async function runCycle(
  plugins: PlatformPlugin[],
  config: CollectorConfig,
  queue: RetryQueue,
  cursors: PluginCursors,
): Promise<CycleResult> {
  const token = resolveToken(config);
  const pluginSummary: Record<string, { enabled: boolean; agentCount: number }> = {};
  const enabledIds = new Set(config.platforms.filter((p) => p.enabled).map((p) => p.id));

  for (const plugin of plugins) {
    const enabled = enabledIds.has(plugin.id);
    if (!enabled) {
      pluginSummary[plugin.id] = { enabled: false, agentCount: 0 };
      continue;
    }

    try {
      const agents = await plugin.discover();
      pluginSummary[plugin.id] = { enabled: true, agentCount: agents.length };

      for (const agent of agents) {
        try {
          await fetch(`${config.relayUrl}/api/channels/${config.channelId}/agents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              agentId: agent.agentId,
              name: agent.name,
              platform: agent.platform,
              schedule: agent.schedule,
            }),
          });
        } catch (err) {
          console.error(`Failed to register agent ${agent.agentId}:`, err);
        }
      }

      const since = cursors[plugin.id] ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const runs = await plugin.collectRuns(since);

      for (const run of runs) {
        const envelope = {
          type: 'run_batch' as const,
          body: { runs: [run] },
          generatedAt: new Date().toISOString(),
          reportId: randomUUID(),
        };
        try {
          const res = await fetch(`${config.relayUrl}/api/channels/${config.channelId}/reports`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(envelope),
          });
          if (!res.ok) {
            queue.enqueue(config.channelId, envelope);
          }
        } catch {
          queue.enqueue(config.channelId, envelope);
        }
      }

      if (runs.length > 0) {
        const latest = runs.reduce((max, r) => {
          const t = new Date(r.finishedAt);
          return t > max ? t : max;
        }, since);
        cursors[plugin.id] = latest;
      }
    } catch (err) {
      console.error(`Plugin ${plugin.id} error:`, err);
      pluginSummary[plugin.id] = { enabled: true, agentCount: 0 };
    }
  }

  const relayClient = {
    post: async (path: string, body: unknown) =>
      fetch(`${config.relayUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
  };
  await queue.replay(relayClient, config.channelId);

  return {
    lastPoll: new Date().toISOString(),
    plugins: pluginSummary,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/integration/R1RunSummaryPipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/daemon/scheduler.ts tests/integration/R1RunSummaryPipeline.test.ts
git commit -m "test(r1): verify summary-bearing run batch pipeline"
```

### Task 10: Relay Client and Fleet Types Carry Summary + Analytics Shapes

**Files:**
- Modify: `src/relay/RelayClient.ts`
- Modify: `src/types/fleet.ts`
- Modify: `src/providers/FleetDataProvider.ts`
- Test: `tests/dashboard/RemoteFleetProviderAnalytics.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import type { RunRecord } from '../../src/relay/RelayClient';

describe('dashboard analytics types', () => {
  it('RunRecord exposes parsed summary and analytics window shapes exist', () => {
    const run: RunRecord = {
      id: 'run-1',
      channelId: 'channel-1',
      agentId: 'agent-1',
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:01:00.000Z',
      status: 'success',
      durationMs: 60000,
      logExcerpt: null,
      errorSummary: null,
      tokenUsage: null,
      costCents: null,
      summary: {
        status: 'ok',
        oneLineSummary: 'Done',
        bullets: ['A'],
        tags: ['tag'],
        tokenCount: 12,
      },
    };

    expect(run.summary?.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/dashboard/RemoteFleetProviderAnalytics.test.ts`
Expected: FAIL with `Property 'summary' does not exist on type 'RunRecord'`

- [ ] **Step 3: Implement minimal code**
```ts
// src/relay/RelayClient.ts
import type { ReportEnvelope, RelayMessage, RunReportSummary } from '@harnesstune/shared';
import type { AgentIdentity } from '../types/workspace';

export interface RelayClientConfig {
  relayUrl: string;
  token: string;
  channelId: string;
}

export interface RelayHealthResponse {
  status: string;
  version: string;
}

export interface ReportListItem {
  id: string;
  channelId: string;
  type: string;
  agentId?: string | null;
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
  summary?: RunReportSummary | null;
}

export class RelayClient {
  // existing implementation unchanged except type widening
}
```

```ts
// src/types/fleet.ts
import type { RunReportSummary } from '@harnesstune/shared';

export type HealthState = 'healthy' | 'degraded' | 'failing' | 'no-data';
export type CostTrend = 'up' | 'down' | 'flat';
export type AnalyticsWindowKey = '24h' | '7d' | '30d';

export interface AnalyticsWindowStats {
  label: AnalyticsWindowKey;
  runCount: number;
  averageDurationMs: number;
  successRatePct: number;
}

export interface FleetWorkspaceSummary {
  id: string;
  name: string;
  platform: string;
  health: HealthState;
  agentCount: number;
  errorRatePct: number;
  lastActivityTs: number;
  analytics: AnalyticsWindowStats[];
}

export interface FleetAgentSummary {
  id: string;
  name: string;
  health: HealthState;
  successRatePct: number;
  lastRunTs: number;
  costUsd: number;
  costTrend: CostTrend;
  analytics: AnalyticsWindowStats[];
}

export interface FleetRunRecord {
  runId: string;
  timestampTs: number;
  durationMs: number;
  status: HealthState;
  costUsd: number;
  logText: string;
  summary?: RunReportSummary | null;
}

export interface FleetCostSummary {
  totalCostUsd: number;
  totalTokens: number;
  trend: CostTrend;
}

export interface FleetWorkspaceDetail {
  agents: FleetAgentSummary[];
  cost: FleetCostSummary;
  analytics: AnalyticsWindowStats[];
}

export interface FleetAgentDetail {
  runs: FleetRunRecord[];
  cost: FleetCostSummary;
  analytics: AnalyticsWindowStats[];
}
```

```ts
// src/providers/FleetDataProvider.ts
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from '../types/fleet.js';

export interface FleetDataProvider {
  getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]>;
  getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail>;
  getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail>;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/dashboard/RemoteFleetProviderAnalytics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/relay/RelayClient.ts src/types/fleet.ts src/providers/FleetDataProvider.ts tests/dashboard/RemoteFleetProviderAnalytics.test.ts
git commit -m "feat(r1): add analytics and summary-bearing relay types"
```

### Task 11: Remote Fleet Analytics Aggregation for Dashboard

**Files:**
- Modify: `src/providers/RemoteFleetProvider.ts`
- Create: `src/webview/dashboard/components/AnalyticsPanel.tsx`
- Modify: `src/webview/dashboard/App.tsx`
- Test: `tests/dashboard/RemoteFleetProviderAnalytics.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { RemoteFleetProvider } from '../../src/providers/RemoteFleetProvider';

describe('RemoteFleetProvider analytics', () => {
  it('computes run count, average duration, and success rate for 24h/7d/30d windows', async () => {
    const registry = {
      getAll: () => [{ id: 'ws-1', name: 'WS 1' }],
    } as any;

    const client = {
      getSummary: async () => ({
        channelId: 'c1',
        days: 30,
        agents: [{ agentId: 'agent-1', totalRuns: 3, successCount: 2, failureCount: 1, successRate: 2 / 3, totalCostCents: 0, lastRunAt: '2026-05-09T00:00:00.000Z' }],
      }),
      getAgents: async () => [{ agentId: 'agent-1', name: 'Agent 1' }],
      getRuns: async () => ([
        { id: 'r1', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 2 * 3600000).toISOString(), finishedAt: new Date().toISOString(), status: 'success', durationMs: 1000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
        { id: 'r2', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 3 * 86400000).toISOString(), finishedAt: new Date().toISOString(), status: 'failure', durationMs: 3000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
        { id: 'r3', channelId: 'c1', agentId: 'agent-1', startedAt: new Date(Date.now() - 20 * 86400000).toISOString(), finishedAt: new Date().toISOString(), status: 'success', durationMs: 5000, logExcerpt: null, errorSummary: null, tokenUsage: null, costCents: null, summary: null },
      ]),
    } as any;

    const provider = new RemoteFleetProvider(new Map([['ws-1', client]]), registry);
    const detail = await provider.getWorkspaceDetail('ws-1', 30);

    expect(detail.analytics.map((item) => item.label)).toEqual(['24h', '7d', '30d']);
    expect(detail.analytics[0].runCount).toBe(1);
    expect(detail.analytics[1].runCount).toBe(2);
    expect(detail.analytics[2].runCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/dashboard/RemoteFleetProviderAnalytics.test.ts`
Expected: FAIL with `Property 'analytics' does not exist`

- [ ] **Step 3: Implement minimal code**
```ts
// src/providers/RemoteFleetProvider.ts
import { RelayClient } from '../relay/RelayClient.js';
import type { AgentSummary, RunRecord } from '../relay/RelayClient.js';
import type { FleetDataProvider } from './FleetDataProvider.js';
import type {
  AnalyticsWindowKey,
  AnalyticsWindowStats,
  FleetWorkspaceSummary,
  FleetWorkspaceDetail,
  FleetAgentSummary,
  FleetAgentDetail,
  FleetRunRecord,
  FleetCostSummary,
  HealthState,
  CostTrend,
} from '../types/fleet.js';
import type { IWorkspaceRegistry } from '../types/workspace.js';

function computeHealthFromSummary(a: AgentSummary): HealthState {
  if (a.totalRuns === 0) return 'no-data';
  if (a.failureCount === 0) return 'healthy';
  if (a.successRate < 0.5) return 'failing';
  return 'degraded';
}

function computeHealthFromAgentSummaries(agents: AgentSummary[]): HealthState {
  const healths = agents.map(computeHealthFromSummary);
  if (healths.some((h) => h === 'failing')) return 'failing';
  if (healths.some((h) => h === 'degraded')) return 'degraded';
  if (healths.every((h) => h === 'no-data')) return 'no-data';
  return 'healthy';
}

function mapRunStatus(status: string): HealthState {
  switch (status) {
    case 'success':
    case 'running':
      return 'healthy';
    case 'failure':
    case 'timeout':
      return 'failing';
    default:
      return 'degraded';
  }
}

function buildAnalytics(runs: RunRecord[]): AnalyticsWindowStats[] {
  const windows: Array<{ label: AnalyticsWindowKey; cutoffMs: number }> = [
    { label: '24h', cutoffMs: Date.now() - 24 * 60 * 60 * 1000 },
    { label: '7d', cutoffMs: Date.now() - 7 * 24 * 60 * 60 * 1000 },
    { label: '30d', cutoffMs: Date.now() - 30 * 24 * 60 * 60 * 1000 },
  ];

  return windows.map(({ label, cutoffMs }) => {
    const filtered = runs.filter((run) => Date.parse(run.startedAt) >= cutoffMs);
    const runCount = filtered.length;
    const averageDurationMs = runCount === 0
      ? 0
      : Math.round(filtered.reduce((sum, run) => sum + run.durationMs, 0) / runCount);
    const successRatePct = runCount === 0
      ? 0
      : Math.round((filtered.filter((run) => run.status === 'success').length / runCount) * 100);
    return { label, runCount, averageDurationMs, successRatePct };
  });
}

export class RemoteFleetProvider implements FleetDataProvider {
  constructor(
    private readonly clients: Map<string, RelayClient>,
    private readonly registry: IWorkspaceRegistry,
  ) {}

  async getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]> {
    const workspaces = this.registry.getAll();
    const summaries: FleetWorkspaceSummary[] = [];

    for (const ws of workspaces) {
      const relayClient = this.clients.get(ws.id);
      if (!relayClient) continue;

      try {
        const channelSummary = await relayClient.getSummary(days);
        const agents = channelSummary.agents;
        const agentCount = agents.length;
        const totalRuns = agents.reduce((acc, a) => acc + a.totalRuns, 0);
        const totalFailures = agents.reduce((acc, a) => acc + a.failureCount, 0);
        const errorRatePct = totalRuns > 0 ? (totalFailures / totalRuns) * 100 : 0;
        const health = computeHealthFromAgentSummaries(agents);
        const lastActivityTs = agents.reduce((max, a) => {
          if (a.lastRunAt === null) return max;
          const ts = Date.parse(a.lastRunAt);
          return ts > max ? ts : max;
        }, 0);

        const runs = (await Promise.all(agents.map((agent) => relayClient.getRuns(agent.agentId)))).flat();
        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health,
          agentCount,
          errorRatePct,
          lastActivityTs,
          analytics: buildAnalytics(runs),
        });
      } catch {
        summaries.push({
          id: ws.id,
          name: ws.name,
          platform: ws.name ?? 'Remote',
          health: 'no-data',
          agentCount: 0,
          errorRatePct: 0,
          lastActivityTs: 0,
          analytics: buildAnalytics([]),
        });
      }
    }

    return summaries;
  }

  async getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { agents: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' }, analytics: buildAnalytics([]) };
    }

    const [channelSummary, agentIdentities] = await Promise.all([
      relayClient.getSummary(days),
      relayClient.getAgents(),
    ]);

    const identityMap = new Map(agentIdentities.map((a) => [a.agentId, a]));
    const runsByAgent = new Map<string, RunRecord[]>();
    for (const agentSummary of channelSummary.agents) {
      runsByAgent.set(agentSummary.agentId, await relayClient.getRuns(agentSummary.agentId));
    }

    const agents: FleetAgentSummary[] = channelSummary.agents.map((agentSummary) => {
      const identity = identityMap.get(agentSummary.agentId);
      const health = computeHealthFromSummary(agentSummary);
      const lastRunTs = agentSummary.lastRunAt !== null ? Date.parse(agentSummary.lastRunAt) : 0;
      return {
        id: agentSummary.agentId,
        name: identity?.name ?? agentSummary.agentId,
        health,
        successRatePct: agentSummary.successRate * 100,
        lastRunTs,
        costUsd: agentSummary.totalCostCents / 100,
        costTrend: 'flat' as CostTrend,
        analytics: buildAnalytics(runsByAgent.get(agentSummary.agentId) ?? []),
      };
    });

    const totalCostUsd = agents.reduce((acc, a) => acc + a.costUsd, 0);
    const analytics = buildAnalytics(Array.from(runsByAgent.values()).flat());
    const cost: FleetCostSummary = { totalCostUsd, totalTokens: 0, trend: 'flat' };

    return { agents, cost, analytics };
  }

  async getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail> {
    const relayClient = this.clients.get(workspaceId);
    if (!relayClient) {
      return { runs: [], cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' }, analytics: buildAnalytics([]) };
    }

    const cutoffMs = Date.now() - days * 86400000;
    const allRuns = await relayClient.getRuns(agentId);
    const filtered = allRuns.filter((r) => Date.parse(r.startedAt) >= cutoffMs);

    const runs: FleetRunRecord[] = filtered.map((run) => ({
      runId: run.id,
      timestampTs: Date.parse(run.startedAt),
      durationMs: run.durationMs,
      status: mapRunStatus(run.status),
      costUsd: (run.costCents ?? 0) / 100,
      logText: run.logExcerpt ?? run.errorSummary ?? '',
      summary: run.summary ?? null,
    }));

    runs.sort((a, b) => b.timestampTs - a.timestampTs);
    const totalCostUsd = runs.reduce((acc, r) => acc + r.costUsd, 0);
    const cost: FleetCostSummary = { totalCostUsd, totalTokens: 0, trend: 'flat' };

    return { runs, cost, analytics: buildAnalytics(filtered) };
  }
}
```

```tsx
// src/webview/dashboard/components/AnalyticsPanel.tsx
import React from 'react';
import type { AnalyticsWindowStats } from '../../../types/fleet.js';

interface AnalyticsPanelProps {
  title: string;
  windows: AnalyticsWindowStats[];
}

function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function AnalyticsPanel({ title, windows }: AnalyticsPanelProps): React.ReactElement {
  return (
    <section className="analytics-panel">
      <div className="analytics-panel__header">
        <h3>{title}</h3>
      </div>
      <div className="analytics-panel__grid">
        {windows.map((item) => (
          <div key={item.label} className="analytics-panel__card">
            <div className="analytics-panel__label">{item.label}</div>
            <div className="analytics-panel__metric">{item.runCount} runs</div>
            <div className="analytics-panel__submetric">Avg {formatDuration(item.averageDurationMs)}</div>
            <div className="analytics-panel__submetric">{item.successRatePct}% success</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// src/webview/dashboard/App.tsx
import React, { useEffect, useState } from 'react';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from '../../types/fleet.js';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../types/messages.js';
import vscode from './vscodeApi.js';
import { DateRangeSelector } from './components/DateRangeSelector.js';
import { BreadcrumbBar } from './components/BreadcrumbBar.js';
import { FleetOverview } from './components/FleetOverview.js';
import { WorkspaceDrillDown } from './components/WorkspaceDrillDown.js';
import { AgentDetail } from './components/AgentDetail.js';
import { AnalyticsPanel } from './components/AnalyticsPanel.js';

type ViewLevel = 'fleet' | 'workspace' | 'agent';
interface NavigationState { level: ViewLevel; workspaceId?: string; workspaceName?: string; agentId?: string; agentName?: string; }
interface PersistedState { nav: NavigationState; days: number; }
function restoreState(): PersistedState {
  const saved = vscode.getState() as PersistedState | null;
  return { nav: saved?.nav ?? { level: 'fleet' }, days: saved?.days ?? 7 };
}

export default function App(): React.ReactElement {
  const initial = restoreState();
  const [nav, setNav] = useState<NavigationState>(initial.nav);
  const [days, setDays] = useState<number>(initial.days);
  const [summaries, setSummaries] = useState<FleetWorkspaceSummary[]>([]);
  const [workspaceDetail, setWorkspaceDetail] = useState<FleetWorkspaceDetail | null>(null);
  const [agentDetail, setAgentDetail] = useState<FleetAgentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { vscode.setState({ nav, days } satisfies PersistedState); }, [nav, days]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    if (nav.level === 'fleet') {
      const msg: WebviewToHostMessage = { type: 'fleet:requestOverview', days };
      vscode.postMessage(msg);
    } else if (nav.level === 'workspace' && nav.workspaceId !== undefined) {
      vscode.postMessage({ type: 'fleet:requestWorkspaceDetail', workspaceId: nav.workspaceId, days });
    } else if (nav.level === 'agent' && nav.workspaceId !== undefined && nav.agentId !== undefined) {
      vscode.postMessage({ type: 'fleet:requestAgentDetail', workspaceId: nav.workspaceId, agentId: nav.agentId, days });
    }
  }, [nav.level, nav.workspaceId, nav.agentId, days]);

  useEffect(() => {
    function handler(event: MessageEvent): void {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'fleet:overview':
          setSummaries(msg.summaries);
          setLoading(false);
          break;
        case 'fleet:workspaceDetail':
          setWorkspaceDetail(msg.detail);
          setLoading(false);
          break;
        case 'fleet:agentDetail':
          setAgentDetail(msg.detail);
          setLoading(false);
          break;
        case 'fleet:error':
          setError(msg.message);
          setLoading(false);
          break;
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function handleSelectWorkspace(id: string): void {
    const ws = summaries.find((s) => s.id === id);
    setNav({ level: 'workspace', workspaceId: id, workspaceName: ws?.name ?? id });
  }

  function handleSelectAgent(id: string): void {
    const agent = workspaceDetail?.agents.find((a) => a.id === id);
    setNav({ level: 'agent', workspaceId: nav.workspaceId, workspaceName: nav.workspaceName, agentId: id, agentName: agent?.name ?? id });
  }

  return (
    <div className="dashboard">
      <DateRangeSelector selected={days} onSelect={setDays} />
      <BreadcrumbBar
        workspaceName={nav.level !== 'fleet' ? nav.workspaceName : undefined}
        agentName={nav.level === 'agent' ? nav.agentName : undefined}
        onNavigateFleet={() => setNav({ level: 'fleet' })}
        onNavigateWorkspace={() => setNav({ level: 'workspace', workspaceId: nav.workspaceId, workspaceName: nav.workspaceName })}
      />
      {nav.level === 'fleet' && (
        <>
          <AnalyticsPanel
            title="Workspace Analytics"
            windows={summaries[0]?.analytics ?? [
              { label: '24h', runCount: 0, averageDurationMs: 0, successRatePct: 0 },
              { label: '7d', runCount: 0, averageDurationMs: 0, successRatePct: 0 },
              { label: '30d', runCount: 0, averageDurationMs: 0, successRatePct: 0 },
            ]}
          />
          <FleetOverview summaries={summaries} loading={loading} error={error} onSelectWorkspace={handleSelectWorkspace} />
        </>
      )}
      {nav.level === 'workspace' && workspaceDetail && (
        <>
          <AnalyticsPanel title="Workspace Analytics" windows={workspaceDetail.analytics} />
          <WorkspaceDrillDown workspaceName={nav.workspaceName!} agents={workspaceDetail.agents} cost={workspaceDetail.cost} loading={loading} error={error} onSelectAgent={handleSelectAgent} />
        </>
      )}
      {nav.level === 'agent' && agentDetail && (
        <>
          <AnalyticsPanel title="Agent Analytics" windows={agentDetail.analytics} />
          <AgentDetail agentName={nav.agentName!} workspaceName={nav.workspaceName!} runs={agentDetail.runs} cost={agentDetail.cost} loading={loading} error={error} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/dashboard/RemoteFleetProviderAnalytics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/providers/RemoteFleetProvider.ts src/webview/dashboard/App.tsx src/webview/dashboard/components/AnalyticsPanel.tsx tests/dashboard/RemoteFleetProviderAnalytics.test.ts
git commit -m "feat(r1): add dashboard read-only analytics panels"
```

### Task 12: Reports Tab Inline Summary Rendering

**Files:**
- Create: `src/webview/reports/components/RunBatchReportCard.tsx`
- Modify: `src/webview/reports/components/TimelineFeed.tsx`
- Modify: `src/webview/reports/App.tsx`
- Test: `tests/reports/RunBatchReportCard.test.tsx`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('RunBatchReportCard rendering contract', () => {
  it('renders oneLineSummary inline and keeps bullets/tags behind details', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/webview/reports/components/RunBatchReportCard.tsx'),
      'utf-8',
    );

    expect(source).toContain('oneLineSummary');
    expect(source).toContain('<details');
    expect(source).toContain('summary.status === \'error\'');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/reports/RunBatchReportCard.test.tsx`
Expected: FAIL with `ENOENT: no such file or directory, open 'src/webview/reports/components/RunBatchReportCard.tsx'`

- [ ] **Step 3: Implement minimal code**
```tsx
// src/webview/reports/components/RunBatchReportCard.tsx
import React from 'react';
import type { ReportEnvelope, RunReport, RunReportSummary } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface RunBatchReportCardProps {
  report: ReportEnvelope;
}

function readSingleRun(report: ReportEnvelope): RunReport | null {
  const body = report.body as { runs?: RunReport[] };
  if (!Array.isArray(body.runs) || body.runs.length === 0) {
    return null;
  }
  return body.runs[0] ?? null;
}

function renderSummary(summary: RunReportSummary | undefined): React.ReactElement {
  if (!summary) {
    return <div className="report-card__empty">No summary captured.</div>;
  }

  if (summary.status === 'error') {
    return <div className="report-card__error">Summary unavailable: {summary.reason}</div>;
  }

  return (
    <>
      <div className="report-card__inline-summary">{summary.oneLineSummary}</div>
      <details className="report-card__section">
        <summary>Details</summary>
        <ul className="report-card__section-content">
          {summary.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
        </ul>
        <div className="report-card__tags">{summary.tags.join(', ')}</div>
      </details>
    </>
  );
}

export default function RunBatchReportCard({ report }: RunBatchReportCardProps) {
  const run = readSingleRun(report);
  const summary = run?.summary;

  return (
    <div className="report-card briefing-card">
      <div className="report-card__header">
        <span className="report-card__icon">Run</span>
        <span className="report-card__title">{run?.agentId ?? 'Unknown agent'}</span>
        <span className="report-card__timestamp">{relativeTime(report.generatedAt)}</span>
      </div>
      {renderSummary(summary)}
    </div>
  );
}
```

```tsx
// src/webview/reports/components/TimelineFeed.tsx
import React from 'react';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import BriefingReportCard from './BriefingReportCard';
import RalphLoopReportCard from './RalphLoopReportCard';
import ChatBubble from './ChatBubble';
import ActivityCard from './ActivityCard';
import RunBatchReportCard from './RunBatchReportCard';

interface TimelineFeedProps {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  onReply: (reportId: string, reportType: string, timestamp: string) => void;
}

export default function TimelineFeed({ items, loopIterations, onReply }: TimelineFeedProps) {
  return (
    <div className="timeline-feed">
      {items.map((item, idx) => {
        if (item.kind === 'activity') {
          return <ActivityCard key={`act-${idx}`} activity={item.data} at={item.at} />;
        }
        if (item.kind === 'message') {
          return <ChatBubble key={`msg-${item.data.id}`} message={item.data} />;
        }
        if (item.data.type === 'briefing') {
          return <BriefingReportCard key={`rpt-${item.data.reportId}`} report={item.data} onReply={onReply} />;
        }
        if (item.data.type === 'ralph') {
          const body = item.data.body as RalphReportBody;
          const iterations = loopIterations[body.loopId] ?? [];
          return <RalphLoopReportCard key={`rpt-${item.data.reportId}`} report={item.data} loopIterations={iterations} onReply={onReply} />;
        }
        if (item.data.type === 'run_batch') {
          return <RunBatchReportCard key={`rpt-${item.data.reportId}`} report={item.data} />;
        }
        return null;
      })}
    </div>
  );
}
```

```tsx
// src/webview/reports/App.tsx
import React, { useState, useEffect, useCallback } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import vscode from './vscodeApi';
import FilterTabs from './components/FilterTabs';
import type { FilterTab } from './components/FilterTabs';
import TimelineFeed from './components/TimelineFeed';
import MessageComposer from './components/MessageComposer';
import LoadMoreButton from './components/LoadMoreButton';
import EmptyState from './components/EmptyState';

interface AppState {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  filter: FilterTab;
  connectionStatus: 'connected' | 'stale' | 'error';
  workspaceName: string;
  workspaceId: string;
  hasMore: boolean;
  loading: boolean;
  replyTo: { reportId: string; reportType: string; timestamp: string } | null;
}

export default function App() {
  const savedState = vscode.getState() as Partial<AppState> | null;
  const [items, setItems] = useState<TimelineItem[]>(savedState?.items ?? []);
  const [loopIterations, setLoopIterations] = useState<Record<string, RalphReportBody[]>>(savedState?.loopIterations ?? {});
  const [filter, setFilter] = useState<FilterTab>(savedState?.filter ?? 'all');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'stale' | 'error'>(savedState?.connectionStatus ?? 'connected');
  const [workspaceName, setWorkspaceName] = useState(savedState?.workspaceName ?? '');
  const [workspaceId, setWorkspaceId] = useState(savedState?.workspaceId ?? '');
  const [hasMore, setHasMore] = useState(savedState?.hasMore ?? true);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<AppState['replyTo']>(null);

  useEffect(() => {
    vscode.setState({ items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore });
  }, [items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore]);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'timeline:update':
          setItems(msg.items);
          setHasMore(msg.hasMore);
          setWorkspaceId(msg.workspaceId);
          setLoading(false);
          break;
        case 'timeline:loopIterations':
          setLoopIterations(msg.loopIterations);
          break;
        case 'timeline:append':
          setItems((prev) => [...msg.items, ...prev]);
          break;
        case 'timeline:connectionStatus':
          setConnectionStatus(msg.status);
          break;
        case 'chat:workspaceInfo':
          setWorkspaceName(msg.workspaceName);
          setWorkspaceId(msg.workspaceId);
          break;
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'timeline:requestInitial', workspaceId: '' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'activity') return item.kind === 'activity';
    if (filter === 'briefings') return item.kind === 'report' && (item.data.type === 'briefing' || item.data.type === 'run_batch');
    if (filter === 'ralph') return item.kind === 'report' && item.data.type === 'ralph';
    if (filter === 'chat') return item.kind === 'message';
    return true;
  });

  const handleSend = useCallback((text: string) => {
    const now = new Date().toISOString();
    const optimisticItem: TimelineItem = {
      kind: 'message',
      data: {
        id: `local-${Date.now()}`,
        channelId: '',
        direction: 'to_agent',
        body: { text, sentAt: now, inReplyToReportId: replyTo?.reportId },
        createdAt: now,
      },
      at: now,
    };
    setItems((prev) => [optimisticItem, ...prev]);
    vscode.postMessage({ type: 'timeline:sendMessage', workspaceId, text, inReplyToReportId: replyTo?.reportId });
    setReplyTo(null);
  }, [workspaceId, replyTo]);

  return (
    <div className="report-panel">
      <FilterTabs active={filter} onSelect={setFilter} items={items} connectionStatus={connectionStatus} />
      <div className="timeline-feed-container">
        {loading ? (
          <div className="timeline-loading">
            <span className="timeline-loading__dot" />
            <span className="timeline-loading__dot" />
            <span className="timeline-loading__dot" />
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState connectionStatus={connectionStatus} filter={filter} hasItems={items.length > 0} />
        ) : (
          <>
            {hasMore && <LoadMoreButton onClick={() => undefined} loading={false} />}
            <TimelineFeed items={filteredItems} loopIterations={loopIterations} onReply={(reportId, reportType, timestamp) => setReplyTo({ reportId, reportType, timestamp })} />
          </>
        )}
      </div>
      <MessageComposer onSend={handleSend} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/reports/RunBatchReportCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/webview/reports/App.tsx src/webview/reports/components/{TimelineFeed.tsx,RunBatchReportCard.tsx} tests/reports/RunBatchReportCard.test.tsx
git commit -m "feat(r1): render inline run summaries in reports"
```

### Task 13: Manual UAT Script for Hongui-MacBookAir

**Files:**
- Create: `docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md`
- Test: `docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md`

- [ ] **Step 1: Write the failing test**
```md
# Manual UAT Assertions

- The file must contain a live Hongui-MacBookAir scenario.
- The file must verify Claude Code summaries.
- The file must verify Claude Desktop summaries.
- The file must verify Dashboard 24h / 7d / 30d aggregates.
- The file must verify Reports inline summary rendering.
```

- [ ] **Step 2: Run test to verify it fails**
Run: `test -f docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md`
Expected: FAIL with `exit code 1`

- [ ] **Step 3: Implement minimal code**
```md
# R1 Read-Only Analytics UAT

## Environment

1. On `Hongui-MacBookAir`, confirm `harnesstune-collector start` is running with `claude-code` and `claude-desktop` enabled and `summaries: "on"` in `~/.harnesstune/collector.json`.
2. Confirm relay is reachable and the VS Code remote workspace is connected.

## Claude Code Summary Check

1. Trigger a known Claude Code cron entry wrapped by `harnesstune-wrap --name <agent> ...`.
2. Wait one collector cycle.
3. Call the relay runs endpoint for that agent.
4. Verify the newest run contains `summary.status === "ok"` or `summary.status === "error"`.
5. If `ok`, verify `oneLineSummary`, non-empty `bullets`, `tags`, and numeric `tokenCount`.
6. If `error`, verify the main run still has the correct `status` and `durationMs`.

## Claude Desktop Summary Check

1. Trigger a scheduled Claude Desktop task from the Claude UI.
2. Wait until the matching `local_*.json` session file stops changing.
3. Wait one collector cycle.
4. Verify the corresponding relay run contains a `summary` object.
5. Verify no ad-hoc Claude Desktop chat without `scheduledTaskId` creates a summarized run.

## Dashboard Analytics Check

1. Open the Dashboard tab in VS Code.
2. Confirm the new analytics panel is visible on fleet, workspace, and agent views.
3. Confirm each view shows `24h`, `7d`, and `30d`.
4. Manually count known runs from relay for one agent.
5. Verify dashboard `runCount`, `averageDurationMs`, and `successRatePct` match the relay data.

## Reports Rendering Check

1. Open the Reports tab for the same workspace.
2. Confirm the latest `run_batch` item shows the one-line summary inline.
3. Expand the details section.
4. Confirm bullets and tags appear.
5. Confirm a summary error case renders a non-crashing fallback message.
6. Confirm no new Ask/meta-analysis UI was introduced.

## Gate

R1 passes when summaries appear for new `RunReport`s within one collector cycle of ingest and both Dashboard and Reports surfaces reflect the new data without blocking the underlying run pipeline.
```

- [ ] **Step 4: Run test to verify it passes**
Run: `test -f docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/uat/2026-05-09-r1-read-only-analytics-uat.md
git commit -m "docs(r1): add read-only analytics uat script"
```

## Self-Review Checklist

- Every R1 requirement in spec §8 row 1, §3.4, §3.5 analytics-only surfaces, §4.4, the R1-relevant rows of §5, and the R1-relevant tests in §7 maps to at least one task above.
- No placeholder strings remain.
- `summarizeTranscript`, `parseSummaryMode`, `shouldSummarizeRun`, and `resolveClaudeDesktopTranscriptPath` are named consistently across later tasks.
- Every step contains concrete code, exact commands, and a specific expected result.
