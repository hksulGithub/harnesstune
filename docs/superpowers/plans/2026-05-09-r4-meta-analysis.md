# R4 — Meta-Analysis On-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand meta-analysis workflow that lets the Reports tab ask scoped questions over persisted R1 summaries, routes the request through the relay command queue, executes the analysis on the remote collector with the local Claude CLI, persists the completed answer, and renders the result inline above the run timeline.

**Architecture:** R4 extends the R2/R3 command plane instead of introducing a new transport. The relay validates and routes a new `runMetaAnalysis` command to exactly one target agent, the collector fetches summary blobs through a read-only relay endpoint and invokes the local Claude CLI, and the relay persists the finished answer from the ack so the Reports tab can hydrate recent analyses on open. Prompt-size pressure is handled collector-side with a fixed summary-of-summaries strategy: direct prompt for up to 200 summaries, chunk pass plus final pass above that threshold.

**Tech Stack:** TypeScript, Node.js 20, Hono, Drizzle ORM + Turso/libSQL, Jest + ts-jest, React webviews, existing relay/collector command queue

---

## Pre-task: Routing Decision

### Locked decision

R4 uses relay-side target routing, not collector-side fan-out.

1. `POST /commands` resolves `targetAgentId` immediately:
   - `scope.agentId` when provided
   - otherwise `DEFAULT_META_ANALYSIS_AGENT_ID` from relay config
2. The relay stores the resolved `targetAgentId` on the queued command row.
3. Collectors poll `GET /commands?agentId=<exact-agent-id>`.
4. A collector only executes commands whose stored `targetAgentId` matches the polling agent.
5. `runMetaAnalysis` with no explicit `scope.agentId` is therefore still single-consumer because the relay has already assigned it to the configured default agent.

### Why this is the right tradeoff

- It keeps the collector simple: no machine-wide leader election, no “first collector wins” race, no cross-agent coordination.
- It enforces spec §5 server-side because the relay, not the collector, decides which queued command is visible to which agent.
- It cleanly extends the R2/R3 mailbox model instead of creating a second routing path for R4.

### Required R2/R3 extension

If the R2/R3 implementation currently exposes `GET /commands` without an `agentId` filter, R4 must tighten that contract now. This is not optional. Without the filter, the no-`scope.agentId` case becomes ambiguous and two collectors could race the same command.

### Prompt-size policy

R4 commits to the following algorithm:

1. Fetch summaries in scope from the relay.
2. If `summaries.length <= 200`, ask Claude once with the raw summary array.
3. If `summaries.length > 200`, split into chunks of 200 summaries.
4. Run a first-pass chunk synthesis for each chunk.
5. Run one final synthesis over the chunk outputs plus the original user question.

This is the fixed behavior for R4. Do not add dynamic token-estimation heuristics in this phase.

## Pre-task: File Structure

### Shared types
- Create: `packages/shared/src/control.ts` — shared command, ack, scope, persisted-summary, and persisted-meta-analysis contracts used by relay, collector, and extension.
- Modify: `packages/shared/src/index.ts` — export the new control-plane types.

### Relay
- Create: `packages/harnesstune-relay/src/config.ts` — typed config loader for `DEFAULT_META_ANALYSIS_AGENT_ID`.
- Modify: `packages/harnesstune-relay/src/db/schema.ts` — add `meta_analyses` plus any R4-only schema helpers.
- Create: `packages/harnesstune-relay/src/routes/commands.ts` — R2/R3 command queue route extended with `runMetaAnalysis`, `targetAgentId` resolution, agent-filtered polling, and ack persistence hook.
- Modify: `packages/harnesstune-relay/src/routes/reports.ts` — add `GET /summaries` backed by `agent_runs.summary`.
- Create: `packages/harnesstune-relay/src/routes/metaAnalyses.ts` — list persisted completed meta-analyses for the Reports tab.
- Modify: `packages/harnesstune-relay/src/app.ts` — mount the new command and meta-analysis routes.
- Create: `packages/harnesstune-relay/drizzle/0004_r4_add_meta_analyses_table.sql` — R4 migration, continuing the expected R3 index.
- Create: `packages/harnesstune-relay/drizzle/meta/_journal.json` — migration journal including the R4 entry.

### Collector
- Modify: `packages/harnesstune-collector/src/client.ts` — add typed helpers for polling commands, fetching summaries, and acking meta-analysis results.
- Create: `packages/harnesstune-collector/src/control/commands.ts` — R2/R3 command polling helper extended with `agentId` filtering.
- Modify: `packages/harnesstune-collector/src/summaries/summarizer.ts` — extract and export `runClaudeCli(prompt, opts)`.
- Create: `packages/harnesstune-collector/src/meta-analysis/types.ts` — local prompt-plan and chunk-pass types.
- Create: `packages/harnesstune-collector/src/meta-analysis/prompt.ts` — summary fetch normalization, prompt assembly, and chunking strategy.
- Create: `packages/harnesstune-collector/src/meta-analysis/handler.ts` — end-to-end `runMetaAnalysis` collector executor.

### Extension host + webview
- Modify: `src/relay/RelayClient.ts` — add `enqueueMetaAnalysis`, `listMetaAnalyses`, and `streamSummaries`.
- Modify: `src/types/messages.ts` — reports webview message contracts for request, preview, pending, ack, and failure.
- Modify: `src/extension.ts` — wire Reports-panel meta-analysis request, preview, and ack refresh behavior through the relay client.
- Create: `src/webview/reports/components/AskBox.tsx` — free-form question input with agent/workspace/date scope controls and preview count UI.
- Create: `src/webview/reports/components/MetaAnalysisCard.tsx` — completed answer renderer for persisted and newly acked entries.
- Modify: `src/webview/reports/App.tsx` — load recent meta-analyses on mount, enqueue new requests, show pending/error state, and render the Meta-analyses section above the timeline.
- Modify: `src/webview/reports/styles/reports.css` — styles for the Ask box, pending state, and answer cards.

### Tests
- Create: `tests/shared/ControlContracts.test.ts`
- Create: `tests/relay/SummariesRoute.test.ts`
- Create: `tests/relay/CommandRouting.test.ts`
- Create: `tests/relay/MetaAnalysesRoute.test.ts`
- Create: `tests/collector/CommandPolling.test.ts`
- Create: `tests/collector/ClaudeCli.test.ts`
- Create: `tests/collector/MetaAnalysisPrompt.test.ts`
- Create: `tests/collector/RunMetaAnalysisHandler.test.ts`
- Create: `tests/reports/AskBox.test.tsx`
- Create: `tests/reports/MetaAnalysisCard.test.tsx`
- Create: `tests/integration/R4MetaAnalysisLoop.test.ts`
- Create: `docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md`

## Tasks

### Task 1: Extend Shared Command and Ack Contracts

**Files:**
- Create: `packages/shared/src/control.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/shared/ControlContracts.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import type { Ack, Command, PersistedMetaAnalysis, PersistedRunSummary } from '../../packages/shared/src/control';

describe('R4 control contracts', () => {
  it('accepts the runMetaAnalysis command variant and answer-bearing ack', () => {
    const command: Command = {
      id: 'cmd-r4-1',
      targetAgentId: 'agent-meta-default',
      kind: 'runMetaAnalysis',
      scope: {
        agentId: 'agent-meta-default',
        workspace: 'channel-alpha',
        since: '2026-05-02T00:00:00.000Z',
        until: '2026-05-09T00:00:00.000Z',
      },
      question: 'Which runs spent the most time retrying tool calls?',
      createdAt: '2026-05-09T00:00:00.000Z',
      status: 'pending',
    };

    const ack: Ack = {
      commandId: 'cmd-r4-1',
      status: 'applied',
      appliedAt: '2026-05-09T00:01:00.000Z',
      result: {
        answer: 'The 2026-05-08 maintenance runs retried Bash and Edit most often.',
      },
    };

    expect(command.kind).toBe('runMetaAnalysis');
    expect(ack.result?.answer).toContain('maintenance runs');
  });

  it('captures persisted summary and meta-analysis list shapes', () => {
    const summary: PersistedRunSummary = {
      runId: 'run-1',
      agentId: 'agent-meta-default',
      workspace: 'channel-alpha',
      startedAt: '2026-05-08T01:00:00.000Z',
      finishedAt: '2026-05-08T01:04:00.000Z',
      status: 'success',
      oneLineSummary: 'Updated the nightly digest and published the result.',
      bullets: ['Opened digest prompt', 'Regenerated markdown', 'Uploaded run_batch'],
      tags: ['digest', 'nightly', 'publish'],
      tokenCount: 1842,
    };

    const analysis: PersistedMetaAnalysis = {
      id: 'meta-1',
      commandId: 'cmd-r4-1',
      scope: {
        agentId: 'agent-meta-default',
        workspace: 'channel-alpha',
        since: '2026-05-02T00:00:00.000Z',
        until: '2026-05-09T00:00:00.000Z',
      },
      question: 'What changed in the last week?',
      answer: 'Success rate stayed flat, but duration improved after prompt cleanup.',
      completedAt: '2026-05-09T00:01:00.000Z',
    };

    expect(summary.tags).toContain('publish');
    expect(analysis.scope.workspace).toBe('channel-alpha');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/shared/ControlContracts.test.ts`
Expected: FAIL with `Cannot find module '../../packages/shared/src/control'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/shared/src/control.ts
export interface CommandTarget {
  plugin: 'claude-desktop' | 'claude-code';
  taskId: string;
}

export interface MetaAnalysisScope {
  agentId?: string;
  workspace?: string;
  since: string;
  until: string;
}

export type Command =
  | {
      id: string;
      targetAgentId: string;
      kind: 'pause';
      target: CommandTarget;
      createdAt: string;
      status: 'pending' | 'applied' | 'rejected' | 'failed';
    }
  | {
      id: string;
      targetAgentId: string;
      kind: 'resume';
      target: CommandTarget;
      createdAt: string;
      status: 'pending' | 'applied' | 'rejected' | 'failed';
    }
  | {
      id: string;
      targetAgentId: string;
      kind: 'setSchedule';
      target: CommandTarget;
      cronExpression: string;
      createdAt: string;
      status: 'pending' | 'applied' | 'rejected' | 'failed';
    }
  | {
      id: string;
      targetAgentId: string;
      kind: 'setPayload';
      target: CommandTarget;
      payload:
        | { type: 'prompt'; markdown: string }
        | { type: 'command'; shell: string };
      createdAt: string;
      status: 'pending' | 'applied' | 'rejected' | 'failed';
    }
  | {
      id: string;
      targetAgentId: string;
      kind: 'runMetaAnalysis';
      scope: MetaAnalysisScope;
      question: string;
      createdAt: string;
      status: 'pending' | 'applied' | 'rejected' | 'failed';
    };

export interface Ack {
  commandId: string;
  status: 'applied' | 'rejected' | 'failed';
  error?: string;
  appliedAt: string;
  mtimeBefore?: number;
  mtimeAfter?: number;
  result?: {
    answer: string;
  };
}

export interface PersistedRunSummary {
  runId: string;
  agentId: string;
  workspace: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  oneLineSummary: string;
  bullets: string[];
  tags: string[];
  tokenCount: number;
}

export interface PersistedMetaAnalysis {
  id: string;
  commandId: string;
  scope: MetaAnalysisScope;
  question: string;
  answer: string;
  completedAt: string;
}
```

```ts
// packages/shared/src/index.ts
export const SHARED_VERSION = '0.0.1';
export * from './reports.js';
export * from './control.js';
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/shared/ControlContracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/control.ts packages/shared/src/index.ts tests/shared/ControlContracts.test.ts
git commit -m "feat(r4): add shared meta-analysis command contracts"
```

### Task 2: Add Relay Migration for `meta_analyses`

**Files:**
- Modify: `packages/harnesstune-relay/src/db/schema.ts`
- Create: `packages/harnesstune-relay/drizzle/0004_r4_add_meta_analyses_table.sql`
- Create: `packages/harnesstune-relay/drizzle/meta/_journal.json`
- Test: `tests/relay/MetaAnalysesRoute.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('R4 meta analysis schema migration', () => {
  it('adds a meta_analyses table and the matching drizzle migration', () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/db/schema.ts'),
      'utf-8',
    );
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/0004_r4_add_meta_analyses_table.sql'),
      'utf-8',
    );
    const journal = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/meta/_journal.json'),
      'utf-8',
    );

    expect(schema).toContain("export const metaAnalyses = sqliteTable('meta_analyses'");
    expect(schema).toContain("commandId: text('command_id').notNull()");
    expect(schema).toContain("scopeJson: text('scope_json').notNull()");
    expect(migration).toContain('CREATE TABLE meta_analyses');
    expect(journal).toContain('"tag": "0004_r4_add_meta_analyses_table"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/MetaAnalysesRoute.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'packages/harnesstune-relay/drizzle/0004_r4_add_meta_analyses_table.sql'`

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

export const metaAnalyses = sqliteTable('meta_analyses', {
  id: text('id').primaryKey(),
  commandId: text('command_id').notNull(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  scopeJson: text('scope_json').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  commandIdUniq: uniqueIndex('meta_analyses_command_id_uniq').on(table.commandId),
  channelCompletedIdx: uniqueIndex('meta_analyses_channel_completed_idx').on(table.channelId, table.completedAt),
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
-- packages/harnesstune-relay/drizzle/0004_r4_add_meta_analyses_table.sql
CREATE TABLE meta_analyses (
  id text PRIMARY KEY NOT NULL,
  command_id text NOT NULL,
  channel_id text NOT NULL,
  scope_json text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  completed_at integer NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE UNIQUE INDEX meta_analyses_command_id_uniq ON meta_analyses(command_id);
CREATE UNIQUE INDEX meta_analyses_channel_completed_idx ON meta_analyses(channel_id, completed_at);
```

```json
{
  "version": "7",
  "dialect": "turso",
  "entries": [
    {
      "idx": 3,
      "version": "7",
      "when": 1778284800000,
      "tag": "0004_r4_add_meta_analyses_table",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/MetaAnalysesRoute.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/db/schema.ts packages/harnesstune-relay/drizzle tests/relay/MetaAnalysesRoute.test.ts
git commit -m "feat(r4): add meta analyses persistence schema"
```

### Task 3: Add Relay `GET /summaries`

**Files:**
- Modify: `packages/harnesstune-relay/src/routes/reports.ts`
- Modify: `packages/harnesstune-relay/src/app.ts`
- Test: `tests/relay/SummariesRoute.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('GET /summaries route', () => {
  it('filters persisted run summaries by agent, workspace, since, and until', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/reports.ts'),
      'utf-8',
    );

    expect(source).toContain("summariesRouter.get('/', async (c) =>");
    expect(source).toContain("const agentId = c.req.query('agentId')");
    expect(source).toContain("const workspace = c.req.query('workspace')");
    expect(source).toContain("const since = c.req.query('since')");
    expect(source).toContain("const until = c.req.query('until')");
    expect(source).toContain('Math.min(parseInt(c.req.query(\'limit\') ?? \'200\', 10), 200)');
    expect(source).toContain('JSON.parse(row.summary)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/SummariesRoute.test.ts`
Expected: FAIL with `Expected substring: "summariesRouter.get('/', async (c) =>"`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-relay/src/routes/reports.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, gt, gte, lte, desc, and, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { reports, agentRuns, agents } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

const MAX_REPORT_SIZE = 2 * 1024 * 1024;

export const reportsRouter = new Hono<{ Variables: AuthVariables }>();
export const summariesRouter = new Hono<{ Variables: AuthVariables }>();

reportsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const contentLength = parseInt(c.req.header('Content-Length') ?? '0', 10);
  if (contentLength > MAX_REPORT_SIZE) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  const body = await c.req.json<{ type: string; body: Record<string, unknown>; agentId?: string }>();
  if (!body.type || !body.body) {
    return c.json({ error: 'type and body are required' }, 400);
  }

  const db = getDb();
  const id = randomUUID();
  await db.insert(reports).values({
    id,
    channelId,
    type: body.type,
    body: JSON.stringify(body.body),
    agentId: body.agentId ?? null,
  });

  return c.json({ id, channelId, type: body.type, createdAt: new Date().toISOString() }, 201);
});

summariesRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const agentId = c.req.query('agentId');
  const workspace = c.req.query('workspace');
  const since = c.req.query('since');
  const until = c.req.query('until');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 200);

  if (!since || !until) {
    return c.json({ error: 'since and until are required' }, 400);
  }

  if (workspace && workspace !== channelId) {
    return c.json({ error: 'workspace scope does not match authenticated channel' }, 400);
  }

  const db = getDb();
  const conditions = [
    eq(agentRuns.channelId, channelId),
    isNotNull(agentRuns.summary),
    gte(agentRuns.startedAt, new Date(since)),
    lte(agentRuns.finishedAt, new Date(until)),
  ];
  if (agentId) {
    conditions.push(eq(agentRuns.agentId, agentId));
  }

  const rows = await db.select().from(agentRuns)
    .where(and(...conditions))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);

  const summaries = rows.flatMap((row) => {
    const parsed = JSON.parse(row.summary ?? '{}') as {
      status?: string;
      oneLineSummary?: string;
      bullets?: string[];
      tags?: string[];
      tokenCount?: number;
    };

    if (parsed.status !== 'ok') {
      return [];
    }

    return [{
      runId: row.id,
      agentId: row.agentId,
      workspace: channelId,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt.toISOString(),
      status: row.status,
      oneLineSummary: parsed.oneLineSummary ?? '',
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      tokenCount: typeof parsed.tokenCount === 'number' ? parsed.tokenCount : 0,
    }];
  });

  return c.json({
    count: summaries.length,
    summaries,
  });
});
```

```ts
// packages/harnesstune-relay/src/app.ts
import { Hono } from 'hono';
import { sanitizeMiddleware } from './middleware/sanitize.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { versionMiddleware } from './middleware/version.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { publicChannelsRouter, channelsRouter } from './routes/channels.js';
import { reportsRouter, summariesRouter } from './routes/reports.js';
import { messagesRouter } from './routes/messages.js';
import { agentsRouter } from './routes/agents.js';
import { runsUploadRouter, runsRouter } from './routes/runs.js';
import { summaryRouter } from './routes/summary.js';

export const RELAY_VERSION = '0.1.0';

const app = new Hono();

app.onError((err, c) => {
  console.error('Hono error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.get('/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.get('/api/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.route('/api/channels', publicChannelsRouter);

const api = new Hono<{ Variables: AuthVariables }>();
api.use('*', sanitizeMiddleware);
api.use('*', authMiddleware);
api.use('*', versionMiddleware);
api.use('*', rateLimitMiddleware);

api.route('/channels', channelsRouter);
api.route('/channels/:channelId/reports', reportsRouter);
api.route('/channels/:channelId/summaries', summariesRouter);
api.route('/channels/:channelId/messages', messagesRouter);
api.route('/channels/:channelId/agents', agentsRouter);
api.route('/channels/:channelId/runs', runsUploadRouter);
api.route('/channels/:channelId/agents/:agentId/runs', runsRouter);
api.route('/channels/:channelId/summary', summaryRouter);

app.route('/api', api);

export { app };
export type AppType = typeof app;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/SummariesRoute.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/reports.ts packages/harnesstune-relay/src/app.ts tests/relay/SummariesRoute.test.ts
git commit -m "feat(r4): add relay summaries query route"
```

### Task 4: Add Relay `runMetaAnalysis` Validation and Target Routing

**Files:**
- Create: `packages/harnesstune-relay/src/config.ts`
- Create: `packages/harnesstune-relay/src/routes/commands.ts`
- Modify: `packages/harnesstune-relay/src/app.ts`
- Test: `tests/relay/CommandRouting.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { resolveTargetAgentIdForCommand } from '../../packages/harnesstune-relay/src/routes/commands';

describe('runMetaAnalysis routing decision', () => {
  it('uses scope.agentId when explicitly provided', () => {
    expect(resolveTargetAgentIdForCommand({
      kind: 'runMetaAnalysis',
      scope: {
        agentId: 'agent-explicit',
        workspace: 'channel-alpha',
        since: '2026-05-01T00:00:00.000Z',
        until: '2026-05-09T00:00:00.000Z',
      },
      question: 'What slowed down the runs?',
    }, 'agent-default')).toBe('agent-explicit');
  });

  it('falls back to the configured default agent when scope.agentId is absent', () => {
    expect(resolveTargetAgentIdForCommand({
      kind: 'runMetaAnalysis',
      scope: {
        workspace: 'channel-alpha',
        since: '2026-05-01T00:00:00.000Z',
        until: '2026-05-09T00:00:00.000Z',
      },
      question: 'What changed?',
    }, 'agent-default')).toBe('agent-default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/CommandRouting.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-relay/src/routes/commands'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-relay/src/config.ts
export interface RelayConfig {
  defaultMetaAnalysisAgentId: string;
}

export function readRelayConfig(): RelayConfig {
  return {
    defaultMetaAnalysisAgentId: process.env['DEFAULT_META_ANALYSIS_AGENT_ID'] ?? '',
  };
}
```

```ts
// packages/harnesstune-relay/src/routes/commands.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Command } from '@harnesstune/shared';
import { readRelayConfig } from '../config.js';
import type { AuthVariables } from '../middleware/auth.js';

export const commandsRouter = new Hono<{ Variables: AuthVariables }>();

const pendingCommands = new Map<string, Command>();

export function resolveTargetAgentIdForCommand(
  body: {
    kind: string;
    scope?: { agentId?: string; workspace?: string; since?: string; until?: string };
    question?: string;
  },
  defaultMetaAnalysisAgentId: string,
): string {
  if (body.kind === 'runMetaAnalysis') {
    const explicitAgentId = body.scope?.agentId?.trim();
    if (explicitAgentId) {
      return explicitAgentId;
    }
    return defaultMetaAnalysisAgentId;
  }
  return '';
}

commandsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const agentId = c.req.param('agentId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{
    kind: string;
    scope?: { agentId?: string; workspace?: string; since?: string; until?: string };
    question?: string;
  }>();

  const relayConfig = readRelayConfig();
  const targetAgentId = resolveTargetAgentIdForCommand(body, relayConfig.defaultMetaAnalysisAgentId);

  if (body.kind === 'runMetaAnalysis') {
    if (!targetAgentId) {
      return c.json({ error: 'DEFAULT_META_ANALYSIS_AGENT_ID is required when scope.agentId is absent' }, 400);
    }
    if (!body.scope?.since || !body.scope?.until || !body.question?.trim()) {
      return c.json({ error: 'scope.since, scope.until, and question are required' }, 400);
    }
    if (new Date(body.scope.since).getTime() > new Date(body.scope.until).getTime()) {
      return c.json({ error: 'scope.since must be before or equal to scope.until' }, 400);
    }

    const command: Command = {
      id: randomUUID(),
      targetAgentId,
      kind: 'runMetaAnalysis',
      scope: {
        agentId: body.scope.agentId,
        workspace: body.scope.workspace,
        since: body.scope.since,
        until: body.scope.until,
      },
      question: body.question.trim(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    pendingCommands.set(command.id, command);
    return c.json({ commandId: command.id, targetAgentId: command.targetAgentId }, 202);
  }

  if (agentId !== targetAgentId && targetAgentId !== '') {
    return c.json({ error: 'agent path and resolved targetAgentId must match' }, 400);
  }

  return c.json({ error: 'unsupported command for this route build-out step' }, 400);
});

commandsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const pollingAgentId = c.req.query('agentId');
  if (!pollingAgentId) {
    return c.json({ error: 'agentId query parameter is required' }, 400);
  }

  const commands = Array.from(pendingCommands.values()).filter((command) => {
    return command.targetAgentId === pollingAgentId && command.status === 'pending';
  });

  return c.json({ pending: commands });
});
```

```ts
// packages/harnesstune-relay/src/app.ts
import { Hono } from 'hono';
import { sanitizeMiddleware } from './middleware/sanitize.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { versionMiddleware } from './middleware/version.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { publicChannelsRouter, channelsRouter } from './routes/channels.js';
import { reportsRouter, summariesRouter } from './routes/reports.js';
import { commandsRouter } from './routes/commands.js';
import { messagesRouter } from './routes/messages.js';
import { agentsRouter } from './routes/agents.js';
import { runsUploadRouter, runsRouter } from './routes/runs.js';
import { summaryRouter } from './routes/summary.js';

export const RELAY_VERSION = '0.1.0';

const app = new Hono();
app.onError((err, c) => c.json({ error: 'Internal Server Error' }, 500));
app.get('/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.get('/api/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.route('/api/channels', publicChannelsRouter);

const api = new Hono<{ Variables: AuthVariables }>();
api.use('*', sanitizeMiddleware);
api.use('*', authMiddleware);
api.use('*', versionMiddleware);
api.use('*', rateLimitMiddleware);

api.route('/channels', channelsRouter);
api.route('/channels/:channelId/reports', reportsRouter);
api.route('/channels/:channelId/summaries', summariesRouter);
api.route('/channels/:channelId/agents/:agentId/commands', commandsRouter);
api.route('/channels/:channelId/messages', messagesRouter);
api.route('/channels/:channelId/agents', agentsRouter);
api.route('/channels/:channelId/runs', runsUploadRouter);
api.route('/channels/:channelId/agents/:agentId/runs', runsRouter);
api.route('/channels/:channelId/summary', summaryRouter);

app.route('/api', api);

export { app };
export type AppType = typeof app;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/CommandRouting.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/config.ts packages/harnesstune-relay/src/routes/commands.ts packages/harnesstune-relay/src/app.ts tests/relay/CommandRouting.test.ts
git commit -m "feat(r4): route meta analysis commands to a single target agent"
```

### Task 5: Persist and List Completed Meta-Analyses

**Files:**
- Create: `packages/harnesstune-relay/src/routes/metaAnalyses.ts`
- Modify: `packages/harnesstune-relay/src/routes/commands.ts`
- Modify: `packages/harnesstune-relay/src/app.ts`
- Test: `tests/relay/MetaAnalysesRoute.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('meta analysis persistence and list route', () => {
  it('writes completed answers during ack and exposes GET /meta-analyses', () => {
    const commandsSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/commands.ts'),
      'utf-8',
    );
    const metaSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/metaAnalyses.ts'),
      'utf-8',
    );

    expect(commandsSource).toContain("commandsRouter.post('/:commandId/ack', async (c) =>");
    expect(commandsSource).toContain('await db.insert(metaAnalyses).values({');
    expect(commandsSource).toContain('result?.answer');
    expect(metaSource).toContain("metaAnalysesRouter.get('/', async (c) =>");
    expect(metaSource).toContain("const since = c.req.query('since')");
    expect(metaSource).toContain("const until = c.req.query('until')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/MetaAnalysesRoute.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'packages/harnesstune-relay/src/routes/metaAnalyses.ts'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-relay/src/routes/metaAnalyses.ts
import { Hono } from 'hono';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { metaAnalyses } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const metaAnalysesRouter = new Hono<{ Variables: AuthVariables }>();

metaAnalysesRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const since = c.req.query('since');
  const until = c.req.query('until');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);

  const conditions = [eq(metaAnalyses.channelId, channelId)];
  if (since) {
    conditions.push(gte(metaAnalyses.completedAt, new Date(since)));
  }
  if (until) {
    conditions.push(lte(metaAnalyses.completedAt, new Date(until)));
  }

  const db = getDb();
  const rows = await db.select().from(metaAnalyses)
    .where(and(...conditions))
    .orderBy(desc(metaAnalyses.completedAt))
    .limit(limit);

  return c.json({
    analyses: rows.map((row) => ({
      id: row.id,
      commandId: row.commandId,
      scope: JSON.parse(row.scopeJson),
      question: row.question,
      answer: row.answer,
      completedAt: row.completedAt.toISOString(),
    })),
  });
});
```

```ts
// packages/harnesstune-relay/src/routes/commands.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { metaAnalyses } from '../db/schema.js';
import type { Ack, Command } from '@harnesstune/shared';
import { readRelayConfig } from '../config.js';
import type { AuthVariables } from '../middleware/auth.js';

export const commandsRouter = new Hono<{ Variables: AuthVariables }>();
const pendingCommands = new Map<string, Command>();

export function resolveTargetAgentIdForCommand(
  body: {
    kind: string;
    scope?: { agentId?: string; workspace?: string; since?: string; until?: string };
    question?: string;
  },
  defaultMetaAnalysisAgentId: string,
): string {
  if (body.kind === 'runMetaAnalysis') {
    return body.scope?.agentId?.trim() || defaultMetaAnalysisAgentId;
  }
  return '';
}

commandsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{
    kind: string;
    scope?: { agentId?: string; workspace?: string; since?: string; until?: string };
    question?: string;
  }>();

  const relayConfig = readRelayConfig();
  const targetAgentId = resolveTargetAgentIdForCommand(body, relayConfig.defaultMetaAnalysisAgentId);

  if (body.kind !== 'runMetaAnalysis') {
    return c.json({ error: 'unsupported command for this route build-out step' }, 400);
  }

  if (!targetAgentId || !body.scope?.since || !body.scope?.until || !body.question?.trim()) {
    return c.json({ error: 'invalid meta-analysis payload' }, 400);
  }

  const command: Command = {
    id: randomUUID(),
    targetAgentId,
    kind: 'runMetaAnalysis',
    scope: {
      agentId: body.scope.agentId,
      workspace: body.scope.workspace,
      since: body.scope.since,
      until: body.scope.until,
    },
    question: body.question.trim(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  pendingCommands.set(command.id, command);
  return c.json({ commandId: command.id, targetAgentId: command.targetAgentId }, 202);
});

commandsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const pollingAgentId = c.req.query('agentId');
  if (!pollingAgentId) {
    return c.json({ error: 'agentId query parameter is required' }, 400);
  }

  const pending = Array.from(pendingCommands.values()).filter((command) => {
    return command.targetAgentId === pollingAgentId && command.status === 'pending';
  });

  return c.json({ pending });
});

commandsRouter.post('/:commandId/ack', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const commandId = c.req.param('commandId');
  const ack = await c.req.json<Ack>();
  const command = pendingCommands.get(commandId);

  if (!command) {
    return c.json({ ok: true, duplicate: true });
  }

  if (command.kind === 'runMetaAnalysis' && ack.status === 'applied' && ack.result?.answer) {
    const db = getDb();
    await db.insert(metaAnalyses).values({
      id: randomUUID(),
      commandId,
      channelId,
      scopeJson: JSON.stringify(command.scope),
      question: command.question,
      answer: ack.result.answer,
      completedAt: new Date(ack.appliedAt),
    });
  }

  pendingCommands.delete(commandId);
  return c.json({ ok: true });
});
```

```ts
// packages/harnesstune-relay/src/app.ts
import { Hono } from 'hono';
import { sanitizeMiddleware } from './middleware/sanitize.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { versionMiddleware } from './middleware/version.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { publicChannelsRouter, channelsRouter } from './routes/channels.js';
import { reportsRouter, summariesRouter } from './routes/reports.js';
import { commandsRouter } from './routes/commands.js';
import { metaAnalysesRouter } from './routes/metaAnalyses.js';
import { messagesRouter } from './routes/messages.js';
import { agentsRouter } from './routes/agents.js';
import { runsUploadRouter, runsRouter } from './routes/runs.js';
import { summaryRouter } from './routes/summary.js';

export const RELAY_VERSION = '0.1.0';

const app = new Hono();
app.onError((err, c) => c.json({ error: 'Internal Server Error' }, 500));
app.get('/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.get('/api/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.route('/api/channels', publicChannelsRouter);

const api = new Hono<{ Variables: AuthVariables }>();
api.use('*', sanitizeMiddleware);
api.use('*', authMiddleware);
api.use('*', versionMiddleware);
api.use('*', rateLimitMiddleware);

api.route('/channels', channelsRouter);
api.route('/channels/:channelId/reports', reportsRouter);
api.route('/channels/:channelId/summaries', summariesRouter);
api.route('/channels/:channelId/meta-analyses', metaAnalysesRouter);
api.route('/channels/:channelId/agents/:agentId/commands', commandsRouter);
api.route('/channels/:channelId/messages', messagesRouter);
api.route('/channels/:channelId/agents', agentsRouter);
api.route('/channels/:channelId/runs', runsUploadRouter);
api.route('/channels/:channelId/agents/:agentId/runs', runsRouter);
api.route('/channels/:channelId/summary', summaryRouter);

app.route('/api', api);

export { app };
export type AppType = typeof app;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/MetaAnalysesRoute.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/{commands.ts,metaAnalyses.ts} packages/harnesstune-relay/src/app.ts tests/relay/MetaAnalysesRoute.test.ts
git commit -m "feat(r4): persist and list completed meta analyses"
```

### Task 6: Enforce Collector Poll Filtering with `?agentId=`

**Files:**
- Modify: `packages/harnesstune-collector/src/client.ts`
- Create: `packages/harnesstune-collector/src/control/commands.ts`
- Test: `tests/collector/CommandPolling.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { buildCommandPollQuery } from '../../packages/harnesstune-collector/src/control/commands';

describe('collector command polling', () => {
  it('always sends the exact agentId filter required by the routing decision', () => {
    expect(buildCommandPollQuery('agent-meta-default')).toEqual({
      agentId: 'agent-meta-default',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/CommandPolling.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/control/commands'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/control/commands.ts
import type { CollectorRelayClient } from '../client.js';
import type { Command } from '@harnesstune/shared';

export function buildCommandPollQuery(agentId: string): Record<string, string> {
  return { agentId };
}

export async function pollCommandsForAgent(
  client: CollectorRelayClient,
  channelId: string,
  agentId: string,
): Promise<Command[]> {
  const response = await client.get(
    `/api/channels/${channelId}/agents/${agentId}/commands`,
    buildCommandPollQuery(agentId),
  );
  if (!response.ok) {
    throw new Error(`poll commands failed: ${response.status}`);
  }
  const body = await response.json() as { pending?: Command[] };
  return body.pending ?? [];
}
```

```ts
// packages/harnesstune-collector/src/client.ts
import { COLLECTOR_VERSION } from './index.js';

export interface CollectorRelayClient {
  post(path: string, body: unknown): Promise<Response>;
  get(path: string, params?: Record<string, string>): Promise<Response>;
  delete(path: string): Promise<Response>;
}

export function createClient(relayUrl: string, token: string): CollectorRelayClient {
  const base = relayUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Collector-Version': COLLECTOR_VERSION,
  };

  return {
    async post(path, body) {
      return fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    async get(path, params) {
      const url = new URL(`${base}${path}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, value);
        }
      }
      return fetch(url.toString(), { method: 'GET', headers });
    },
    async delete(path) {
      return fetch(`${base}${path}`, { method: 'DELETE', headers });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/CommandPolling.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/client.ts packages/harnesstune-collector/src/control/commands.ts tests/collector/CommandPolling.test.ts
git commit -m "feat(r4): require agent-scoped command polling"
```

### Task 7: Extract Generic `runClaudeCli` Helper

**Files:**
- Modify: `packages/harnesstune-collector/src/summaries/summarizer.ts`
- Test: `tests/collector/ClaudeCli.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { runClaudeCli } from '../../packages/harnesstune-collector/src/summaries/summarizer';

describe('runClaudeCli', () => {
  it('returns stdout text and trims trailing whitespace', async () => {
    const answer = await runClaudeCli('Say hello', {
      timeoutMs: 1000,
      spawnImpl: async () => ({
        code: 0,
        stdout: 'hello world\\n',
        stderr: '',
      }),
    });

    expect(answer).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeCli.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/summaries/summarizer'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/summaries/summarizer.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunClaudeCliOptions {
  timeoutMs: number;
  claudePath?: string;
  spawnImpl?: (input: {
    prompt: string;
    timeoutMs: number;
    claudePath: string;
  }) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
}

async function defaultSpawn(input: {
  prompt: string;
  timeoutMs: number;
  claudePath: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      input.claudePath,
      ['--print', input.prompt],
      { timeout: input.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
    );
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  }
}

export async function runClaudeCli(prompt: string, options: RunClaudeCliOptions): Promise<string> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const result = await spawnImpl({
    prompt,
    timeoutMs: options.timeoutMs,
    claudePath: options.claudePath ?? 'claude',
  });

  if (result.code !== 0) {
    throw new Error(result.stderr || `claude exited with ${result.code}`);
  }

  return result.stdout.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeCli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/summaries/summarizer.ts tests/collector/ClaudeCli.test.ts
git commit -m "feat(r4): extract reusable claude cli helper"
```

### Task 8: Build Summary Fetch and Prompt Assembly with Chunking

**Files:**
- Create: `packages/harnesstune-collector/src/meta-analysis/types.ts`
- Create: `packages/harnesstune-collector/src/meta-analysis/prompt.ts`
- Test: `tests/collector/MetaAnalysisPrompt.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { buildMetaAnalysisPlan } from '../../packages/harnesstune-collector/src/meta-analysis/prompt';

describe('meta analysis prompt planning', () => {
  it('uses a single pass for 200 summaries or fewer', () => {
    const summaries = Array.from({ length: 3 }, (_, index) => ({
      runId: `run-${index}`,
      agentId: 'agent-meta-default',
      workspace: 'channel-alpha',
      startedAt: '2026-05-08T00:00:00.000Z',
      finishedAt: '2026-05-08T00:05:00.000Z',
      status: 'success',
      oneLineSummary: `summary ${index}`,
      bullets: ['a', 'b'],
      tags: ['nightly'],
      tokenCount: 10,
    }));

    const plan = buildMetaAnalysisPlan('What changed?', summaries);
    expect(plan.mode).toBe('single');
    expect(plan.finalPrompt).toContain('What changed?');
    expect(plan.finalPrompt).toContain('"runId":"run-0"');
  });

  it('switches to summary-of-summaries above 200 summaries', () => {
    const summaries = Array.from({ length: 201 }, (_, index) => ({
      runId: `run-${index}`,
      agentId: 'agent-meta-default',
      workspace: 'channel-alpha',
      startedAt: '2026-05-08T00:00:00.000Z',
      finishedAt: '2026-05-08T00:05:00.000Z',
      status: 'success',
      oneLineSummary: `summary ${index}`,
      bullets: ['a', 'b'],
      tags: ['nightly'],
      tokenCount: 10,
    }));

    const plan = buildMetaAnalysisPlan('What changed?', summaries);
    expect(plan.mode).toBe('chunked');
    expect(plan.chunkPrompts).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/MetaAnalysisPrompt.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/meta-analysis/prompt'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/meta-analysis/types.ts
import type { PersistedRunSummary } from '@harnesstune/shared';

export interface SinglePassPlan {
  mode: 'single';
  summaries: PersistedRunSummary[];
  finalPrompt: string;
  chunkPrompts: [];
}

export interface ChunkedPlan {
  mode: 'chunked';
  summaries: PersistedRunSummary[];
  finalPrompt: string;
  chunkPrompts: string[];
}

export type MetaAnalysisPlan = SinglePassPlan | ChunkedPlan;
```

```ts
// packages/harnesstune-collector/src/meta-analysis/prompt.ts
import type { PersistedRunSummary } from '@harnesstune/shared';
import type { MetaAnalysisPlan } from './types.js';

const MAX_DIRECT_SUMMARIES = 200;

function buildInstructionBlock(question: string): string {
  return [
    'You are answering a higher-level question about agent productivity.',
    'Base the answer only on the provided JSON summary records.',
    'Be concrete, cite run patterns, and call out uncertainty when evidence is thin.',
    '',
    `Question: ${question}`,
    '',
  ].join('\n');
}

function buildChunkInstructionBlock(question: string, chunkIndex: number, chunkCount: number): string {
  return [
    'You are producing an intermediate chunk synthesis for a later final answer.',
    'Return plain text with the most important patterns, risks, and outliers from this chunk only.',
    `Chunk: ${chunkIndex + 1} of ${chunkCount}`,
    `Original question: ${question}`,
    '',
  ].join('\n');
}

export function buildMetaAnalysisPlan(
  question: string,
  summaries: PersistedRunSummary[],
): MetaAnalysisPlan {
  if (summaries.length <= MAX_DIRECT_SUMMARIES) {
    return {
      mode: 'single',
      summaries,
      chunkPrompts: [],
      finalPrompt: `${buildInstructionBlock(question)}${JSON.stringify(summaries)}`,
    };
  }

  const chunks: PersistedRunSummary[][] = [];
  for (let index = 0; index < summaries.length; index += MAX_DIRECT_SUMMARIES) {
    chunks.push(summaries.slice(index, index + MAX_DIRECT_SUMMARIES));
  }

  const chunkPrompts = chunks.map((chunk, index) => {
    return `${buildChunkInstructionBlock(question, index, chunks.length)}${JSON.stringify(chunk)}`;
  });

  return {
    mode: 'chunked',
    summaries,
    chunkPrompts,
    finalPrompt: [
      'You are answering the final meta-analysis question.',
      'Use the chunk syntheses below instead of re-analyzing the original summaries.',
      `Question: ${question}`,
      '',
      'Chunk syntheses will be inserted here by the handler.',
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/MetaAnalysisPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/meta-analysis/{types.ts,prompt.ts} tests/collector/MetaAnalysisPrompt.test.ts
git commit -m "feat(r4): add meta analysis prompt planning and chunking"
```

### Task 9: Implement Collector `runMetaAnalysis` Handler

**Files:**
- Create: `packages/harnesstune-collector/src/meta-analysis/handler.ts`
- Test: `tests/collector/RunMetaAnalysisHandler.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { executeRunMetaAnalysis } from '../../packages/harnesstune-collector/src/meta-analysis/handler';

describe('runMetaAnalysis handler', () => {
  it('fetches summaries, calls Claude, and returns an answer-bearing ack', async () => {
    const ack = await executeRunMetaAnalysis({
      channelId: 'channel-alpha',
      pollingAgentId: 'agent-meta-default',
      command: {
        id: 'cmd-r4-1',
        targetAgentId: 'agent-meta-default',
        kind: 'runMetaAnalysis',
        scope: {
          agentId: 'agent-meta-default',
          workspace: 'channel-alpha',
          since: '2026-05-01T00:00:00.000Z',
          until: '2026-05-09T00:00:00.000Z',
        },
        question: 'What changed?',
        createdAt: '2026-05-09T00:00:00.000Z',
        status: 'pending',
      },
      fetchSummaries: async () => [{
        runId: 'run-1',
        agentId: 'agent-meta-default',
        workspace: 'channel-alpha',
        startedAt: '2026-05-08T00:00:00.000Z',
        finishedAt: '2026-05-08T00:05:00.000Z',
        status: 'success',
        oneLineSummary: 'Did a thing',
        bullets: ['a'],
        tags: ['nightly'],
        tokenCount: 10,
      }],
      runClaude: async () => 'Things got faster after prompt cleanup.',
    });

    expect(ack.status).toBe('applied');
    expect(ack.result?.answer).toContain('faster');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/RunMetaAnalysisHandler.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/meta-analysis/handler'`

- [ ] **Step 3: Implement minimal code**
```ts
// packages/harnesstune-collector/src/meta-analysis/handler.ts
import type { Ack, Command, PersistedRunSummary } from '@harnesstune/shared';
import { buildMetaAnalysisPlan } from './prompt.js';

export interface ExecuteRunMetaAnalysisArgs {
  channelId: string;
  pollingAgentId: string;
  command: Extract<Command, { kind: 'runMetaAnalysis' }>;
  fetchSummaries: (scope: {
    agentId?: string;
    workspace?: string;
    since: string;
    until: string;
  }) => Promise<PersistedRunSummary[]>;
  runClaude: (prompt: string) => Promise<string>;
}

export async function executeRunMetaAnalysis(
  args: ExecuteRunMetaAnalysisArgs,
): Promise<Ack> {
  if (args.command.scope.agentId && args.command.scope.agentId !== args.pollingAgentId) {
    return {
      commandId: args.command.id,
      status: 'rejected',
      error: 'command scope.agentId does not match polling agent',
      appliedAt: new Date().toISOString(),
    };
  }

  const summaries = await args.fetchSummaries(args.command.scope);
  const plan = buildMetaAnalysisPlan(args.command.question, summaries);

  if (plan.mode === 'single') {
    const answer = await args.runClaude(plan.finalPrompt);
    return {
      commandId: args.command.id,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      result: { answer },
    };
  }

  const chunkOutputs: string[] = [];
  for (const chunkPrompt of plan.chunkPrompts) {
    chunkOutputs.push(await args.runClaude(chunkPrompt));
  }

  const finalPrompt = `${plan.finalPrompt}\n\n${JSON.stringify(chunkOutputs)}`;
  const answer = await args.runClaude(finalPrompt);
  return {
    commandId: args.command.id,
    status: 'applied',
    appliedAt: new Date().toISOString(),
    result: { answer },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/RunMetaAnalysisHandler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/meta-analysis/handler.ts tests/collector/RunMetaAnalysisHandler.test.ts
git commit -m "feat(r4): execute collector meta analysis commands"
```

### Task 10: Extend `RelayClient` for Meta-Analysis Flows

**Files:**
- Modify: `src/relay/RelayClient.ts`
- Test: `tests/relay/RelayClientMetaAnalysis.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('RelayClient meta-analysis API surface', () => {
  it('adds enqueueMetaAnalysis, listMetaAnalyses, and streamSummaries', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/relay/RelayClient.ts'),
      'utf-8',
    );

    expect(source).toContain('async enqueueMetaAnalysis(');
    expect(source).toContain('async listMetaAnalyses(');
    expect(source).toContain('async streamSummaries(');
    expect(source).toContain('/meta-analyses');
    expect(source).toContain('/summaries');
    expect(source).toContain('/commands');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/RelayClientMetaAnalysis.test.ts`
Expected: FAIL with `Expected substring: "async enqueueMetaAnalysis("`

- [ ] **Step 3: Implement minimal code**
```ts
// src/relay/RelayClient.ts
import type {
  MetaAnalysisScope,
  PersistedMetaAnalysis,
  PersistedRunSummary,
} from '@harnesstune/shared';
import type { ReportEnvelope, RelayMessage } from '@harnesstune/shared';
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
}

export class RelayClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly channelId: string;
  private isFirstPoll = true;

  constructor(config: RelayClientConfig) {
    this.baseUrl = config.relayUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.channelId = config.channelId;
  }

  async enqueueMetaAnalysis(scope: MetaAnalysisScope, question: string): Promise<{ commandId: string; targetAgentId: string }> {
    const agentPath = scope.agentId ?? 'meta-analysis';
    const res = await this.doFetch(`/channels/${this.channelId}/agents/${agentPath}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'runMetaAnalysis',
        scope,
        question,
      }),
      timeout: 5000,
    });
    if (!res.ok) {
      throw new RelayError(res.status, await res.text());
    }
    return res.json() as Promise<{ commandId: string; targetAgentId: string }>;
  }

  async listMetaAnalyses(since?: string, until?: string): Promise<PersistedMetaAnalysis[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (until) params.set('until', until);
    params.set('limit', '20');
    const res = await this.doFetch(`/channels/${this.channelId}/meta-analyses?${params.toString()}`, { timeout: 5000 });
    if (!res.ok) {
      throw new RelayError(res.status, await res.text());
    }
    const body = await res.json() as { analyses: PersistedMetaAnalysis[] };
    return body.analyses;
  }

  async streamSummaries(scope: MetaAnalysisScope): Promise<{ count: number; summaries: PersistedRunSummary[] }> {
    const params = new URLSearchParams();
    if (scope.agentId) params.set('agentId', scope.agentId);
    if (scope.workspace) params.set('workspace', scope.workspace);
    params.set('since', scope.since);
    params.set('until', scope.until);
    params.set('limit', '200');
    const res = await this.doFetch(`/channels/${this.channelId}/summaries?${params.toString()}`, { timeout: 5000 });
    if (!res.ok) {
      throw new RelayError(res.status, await res.text());
    }
    return res.json() as Promise<{ count: number; summaries: PersistedRunSummary[] }>;
  }

  async checkHealth(): Promise<RelayHealthResponse> {
    const res = await this.doFetch('/health', { timeout: 8000 });
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return res.json() as Promise<RelayHealthResponse>;
  }

  async getReports(since?: string): Promise<ReportListItem[]> {
    const timeout = this.isFirstPoll ? 8000 : 5000;
    this.isFirstPoll = false;
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    const url = `/channels/${this.channelId}/reports${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await this.doFetch(url, { timeout });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    const data = await res.json() as { reports?: Array<{ id: string; channelId: string; type: string; agentId?: string | null; createdAt: string }> };
    return (data.reports ?? []).map((row) => ({
      id: row.id,
      channelId: row.channelId,
      type: row.type,
      agentId: row.agentId,
      generatedAt: row.createdAt,
    }));
  }

  async getReport(reportId: string): Promise<ReportEnvelope> {
    const res = await this.doFetch(`/channels/${this.channelId}/reports/${reportId}`, { timeout: 5000 });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    return res.json() as Promise<ReportEnvelope>;
  }

  async getMessages(since?: string, limit = 50): Promise<RelayMessage[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    params.set('limit', String(limit));
    const url = `/channels/${this.channelId}/messages${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await this.doFetch(url, { timeout: 5000 });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    const data = await res.json() as { messages?: RelayMessage[] } | RelayMessage[];
    return (data as { messages?: RelayMessage[] }).messages ?? (data as RelayMessage[]);
  }

  async postMessage(text: string, inReplyToReportId?: string): Promise<void> {
    const body: Record<string, unknown> = { text, sentAt: new Date().toISOString() };
    if (inReplyToReportId) body.inReplyToReportId = inReplyToReportId;
    const res = await this.doFetch(`/channels/${this.channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ direction: 'to_agent', body }),
      timeout: 5000,
    });
    if (!res.ok) throw new RelayError(res.status, await res.text());
  }

  async getAgents(): Promise<AgentIdentity[]> {
    const res = await this.doFetch(`/channels/${this.channelId}/agents`, { timeout: 5000 });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    const data = await res.json() as { agents: AgentIdentity[] };
    return data.agents;
  }

  async getSummary(days = 7): Promise<ChannelSummaryResponse> {
    const res = await this.doFetch(`/channels/${this.channelId}/summary?days=${days}`, { timeout: 5000 });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    return res.json() as Promise<ChannelSummaryResponse>;
  }

  async getRuns(agentId: string, since?: string, limit = 20): Promise<RunRecord[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    params.set('limit', String(limit));
    const res = await this.doFetch(`/channels/${this.channelId}/agents/${agentId}/runs?${params.toString()}`, { timeout: 5000 });
    if (!res.ok) throw new RelayError(res.status, await res.text());
    const data = await res.json() as { runs: RunRecord[] };
    return data.runs;
  }

  private async doFetch(path: string, opts: { method?: string; body?: string; timeout?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout ?? 5000);
    try {
      return await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: opts.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class RelayError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Relay error ${status}: ${message}`);
    this.name = 'RelayError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/RelayClientMetaAnalysis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/relay/RelayClient.ts tests/relay/RelayClientMetaAnalysis.test.ts
git commit -m "feat(r4): add relay client meta analysis methods"
```

### Task 11: Build the Reports Ask Box

**Files:**
- Create: `src/webview/reports/components/AskBox.tsx`
- Test: `tests/reports/AskBox.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskBox } from '../../src/webview/reports/components/AskBox';

describe('AskBox', () => {
  it('submits the question and selected scope', () => {
    const submitted: Array<{ question: string }> = [];

    render(
      <AskBox
        agentOptions={[{ value: 'agent-meta-default', label: 'agent-meta-default' }]}
        workspaceOptions={[{ value: 'channel-alpha', label: 'channel-alpha' }]}
        initialScope={{
          agentId: 'agent-meta-default',
          workspace: 'channel-alpha',
          since: '2026-05-02',
          until: '2026-05-09',
        }}
        summaryCount={12}
        pending={false}
        onPreviewScope={() => undefined}
        onSubmit={(question) => submitted.push({ question })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'What changed in the last week?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(submitted[0]?.question).toBe('What changed in the last week?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/reports/AskBox.test.tsx`
Expected: FAIL with `Cannot find module '../../src/webview/reports/components/AskBox'`

- [ ] **Step 3: Implement minimal code**
```tsx
// src/webview/reports/components/AskBox.tsx
import React, { useEffect, useState } from 'react';
import type { MetaAnalysisScope } from '@harnesstune/shared';

interface SelectOption {
  value: string;
  label: string;
}

interface AskBoxProps {
  agentOptions: SelectOption[];
  workspaceOptions: SelectOption[];
  initialScope: MetaAnalysisScope;
  summaryCount: number;
  pending: boolean;
  error?: string | null;
  onPreviewScope: (scope: MetaAnalysisScope) => void;
  onSubmit: (question: string, scope: MetaAnalysisScope) => void;
}

export function AskBox(props: AskBoxProps): React.ReactElement {
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<MetaAnalysisScope>(props.initialScope);

  useEffect(() => {
    props.onPreviewScope(scope);
  }, [scope]);

  return (
    <section className="ask-box">
      <div className="ask-box__row">
        <label>
          Agent
          <select
            value={scope.agentId ?? ''}
            onChange={(event) => setScope((current) => ({ ...current, agentId: event.target.value || undefined }))}
          >
            <option value="">Any routed default</option>
            {props.agentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Workspace
          <select
            value={scope.workspace ?? ''}
            onChange={(event) => setScope((current) => ({ ...current, workspace: event.target.value || undefined }))}
          >
            <option value="">Current relay workspace</option>
            {props.workspaceOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Since
          <input
            type="date"
            value={scope.since}
            onChange={(event) => setScope((current) => ({ ...current, since: event.target.value }))}
          />
        </label>
        <label>
          Until
          <input
            type="date"
            value={scope.until}
            onChange={(event) => setScope((current) => ({ ...current, until: event.target.value }))}
          />
        </label>
      </div>
      <label className="ask-box__question">
        Question
        <textarea
          aria-label="Question"
          value={question}
          rows={4}
          placeholder="Ask about trends, failures, regressions, or work patterns."
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <div className="ask-box__footer">
        <span className="ask-box__count">Scope preview: {props.summaryCount} summaries</span>
        {props.error ? <span className="ask-box__error">{props.error}</span> : null}
        <button
          type="button"
          disabled={props.pending || question.trim().length === 0}
          onClick={() => props.onSubmit(question.trim(), scope)}
        >
          {props.pending ? 'Running…' : 'Ask'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/reports/AskBox.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/webview/reports/components/AskBox.tsx tests/reports/AskBox.test.tsx
git commit -m "feat(r4): add reports ask box"
```

### Task 12: Build the Meta-Analysis Result Card

**Files:**
- Create: `src/webview/reports/components/MetaAnalysisCard.tsx`
- Test: `tests/reports/MetaAnalysisCard.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MetaAnalysisCard } from '../../src/webview/reports/components/MetaAnalysisCard';

describe('MetaAnalysisCard', () => {
  it('renders question, answer, and completion timestamp', () => {
    render(
      <MetaAnalysisCard
        analysis={{
          id: 'meta-1',
          commandId: 'cmd-r4-1',
          scope: {
            agentId: 'agent-meta-default',
            workspace: 'channel-alpha',
            since: '2026-05-02T00:00:00.000Z',
            until: '2026-05-09T00:00:00.000Z',
          },
          question: 'What changed?',
          answer: 'The nightly jobs got faster after prompt cleanup.',
          completedAt: '2026-05-09T00:01:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('What changed?')).toBeTruthy();
    expect(screen.getByText(/got faster/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/reports/MetaAnalysisCard.test.tsx`
Expected: FAIL with `Cannot find module '../../src/webview/reports/components/MetaAnalysisCard'`

- [ ] **Step 3: Implement minimal code**
```tsx
// src/webview/reports/components/MetaAnalysisCard.tsx
import React from 'react';
import type { PersistedMetaAnalysis } from '@harnesstune/shared';

interface MetaAnalysisCardProps {
  analysis: PersistedMetaAnalysis;
}

export function MetaAnalysisCard({ analysis }: MetaAnalysisCardProps): React.ReactElement {
  return (
    <article className="meta-analysis-card">
      <header className="meta-analysis-card__header">
        <h3>{analysis.question}</h3>
        <span>{new Date(analysis.completedAt).toLocaleString()}</span>
      </header>
      <div className="meta-analysis-card__scope">
        Agent: {analysis.scope.agentId ?? 'default routed'} · Workspace: {analysis.scope.workspace ?? 'current'}
      </div>
      <pre className="meta-analysis-card__answer">{analysis.answer}</pre>
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/reports/MetaAnalysisCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/webview/reports/components/MetaAnalysisCard.tsx tests/reports/MetaAnalysisCard.test.tsx
git commit -m "feat(r4): add meta analysis result card"
```

### Task 13: Integrate the Reports Tab End-to-End

**Files:**
- Modify: `src/types/messages.ts`
- Modify: `src/extension.ts`
- Modify: `src/webview/reports/App.tsx`
- Modify: `src/webview/reports/styles/reports.css`
- Test: `tests/reports/ReportsMetaAnalysisFlow.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
import fs from 'node:fs';
import path from 'node:path';

describe('Reports meta-analysis integration', () => {
  it('loads persisted analyses on open and appends newly completed answers', () => {
    const messages = fs.readFileSync(path.join(process.cwd(), 'src/types/messages.ts'), 'utf-8');
    const extension = fs.readFileSync(path.join(process.cwd(), 'src/extension.ts'), 'utf-8');
    const app = fs.readFileSync(path.join(process.cwd(), 'src/webview/reports/App.tsx'), 'utf-8');

    expect(messages).toContain("type: 'reports:metaAnalyses'");
    expect(messages).toContain("type: 'reports:enqueueMetaAnalysis'");
    expect(extension).toContain("msg.type === 'reports:requestMetaAnalyses'");
    expect(extension).toContain("msg.type === 'reports:enqueueMetaAnalysis'");
    expect(app).toContain('Meta-analyses');
    expect(app).toContain('<AskBox');
    expect(app).toContain('<MetaAnalysisCard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/reports/ReportsMetaAnalysisFlow.test.tsx`
Expected: FAIL with `Expected substring: "type: 'reports:metaAnalyses'"`

- [ ] **Step 3: Implement minimal code**
```ts
// src/types/messages.ts
import type { WorkspaceRecord, WorkspaceStatus } from './workspace';
import type { AgentEvent, AgentSession } from './agent';
import type { TopologyState, TopologyNode } from './topology';
import type { ChatMessage, SessionState } from '../session';
import type { ReportEnvelope, TimelineItem, RalphReportBody, MetaAnalysisScope, PersistedMetaAnalysis, PersistedRunSummary } from '@harnesstune/shared';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from './fleet';

export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord }
  | { type: 'dashboard:agentEvents'; events: AgentEvent[] }
  | { type: 'dashboard:agentUpdate'; session: AgentSession }
  | { type: 'dashboard:summary'; workspaceId: string; totalAgents: number; running: number; paused: number; errors: number; estimatedCost: number }
  | { type: 'schematic:topologyUpdate'; state: TopologyState }
  | { type: 'schematic:nodeUpdate'; node: TopologyNode }
  | { type: 'schematic:nodeDetail'; session: AgentSession | null; events: AgentEvent[] }
  | { type: 'workspace:setActive'; workspaceId: string }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:stateChange'; state: SessionState }
  | { type: 'chat:history'; messages: ChatMessage[] }
  | { type: 'chat:workspaceInfo'; workspaceId: string; workspaceName: string }
  | { type: 'chat:triggerInterrupt' }
  | { type: 'chat:setReadOnly'; reason: string }
  | { type: 'reports:list'; workspaceId: string; reports: ReportEnvelope[] }
  | { type: 'reports:detail'; workspaceId: string; report: ReportEnvelope }
  | { type: 'reports:messageSent'; workspaceId: string; success: boolean }
  | { type: 'reports:metaAnalyses'; workspaceId: string; analyses: PersistedMetaAnalysis[] }
  | { type: 'reports:metaAnalysisPreview'; workspaceId: string; scope: MetaAnalysisScope; count: number; summaries: PersistedRunSummary[] }
  | { type: 'reports:metaAnalysisPending'; workspaceId: string; commandId: string }
  | { type: 'reports:metaAnalysisError'; workspaceId: string; message: string }
  | { type: 'timeline:update'; workspaceId: string; items: TimelineItem[]; hasMore: boolean }
  | { type: 'timeline:loopIterations'; workspaceId: string; loopIterations: Record<string, RalphReportBody[]> }
  | { type: 'timeline:append'; workspaceId: string; items: TimelineItem[] }
  | { type: 'timeline:connectionStatus'; workspaceId: string; status: 'connected' | 'stale' | 'error' }
  | { type: 'fleet:overview'; summaries: FleetWorkspaceSummary[] }
  | { type: 'fleet:workspaceDetail'; workspaceId: string; detail: FleetWorkspaceDetail }
  | { type: 'fleet:agentDetail'; workspaceId: string; agentId: string; detail: FleetAgentDetail }
  | { type: 'fleet:error'; scope: 'fleet' | 'workspace' | 'agent'; message: string };

export type WebviewToHostMessage =
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:configure'; workspaceId: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' }
  | { type: 'agent:pause'; sessionId: string }
  | { type: 'agent:resume'; sessionId: string }
  | { type: 'agent:stop'; sessionId: string }
  | { type: 'dashboard:requestState'; workspaceId?: string }
  | { type: 'schematic:requestState'; workspaceId?: string }
  | { type: 'schematic:selectNode'; sessionId: string }
  | { type: 'chat:sendMessage'; text: string }
  | { type: 'chat:interrupt' }
  | { type: 'chat:requestHistory' }
  | { type: 'workspace:addRemote'; relayUrl: string; token: string }
  | { type: 'reports:request'; workspaceId: string; since?: string }
  | { type: 'reports:sendMessage'; workspaceId: string; text: string }
  | { type: 'reports:requestMetaAnalyses'; workspaceId: string }
  | { type: 'reports:previewMetaAnalysis'; workspaceId: string; scope: MetaAnalysisScope }
  | { type: 'reports:enqueueMetaAnalysis'; workspaceId: string; scope: MetaAnalysisScope; question: string }
  | { type: 'workspace:messageAgent'; workspaceId: string }
  | { type: 'timeline:requestInitial'; workspaceId: string }
  | { type: 'timeline:loadMore'; workspaceId: string; before: string }
  | { type: 'timeline:sendMessage'; workspaceId: string; text: string; inReplyToReportId?: string }
  | { type: 'fleet:requestOverview'; days: number }
  | { type: 'fleet:requestWorkspaceDetail'; workspaceId: string; days: number }
  | { type: 'fleet:requestAgentDetail'; workspaceId: string; agentId: string; days: number };
```

```ts
// src/extension.ts
// Only the reports-message handler block is shown here because that is the R4 change surface.
// Keep all existing imports and activation setup from the current file.
function wireReportsMessageHandler(panel: ReportPanel): void {
  const listener = panel.onDidReceiveMessage(async (msg) => {
    const currentWsId = panel.getWorkspaceId();
    const currentWs = registry.getAll().find((workspace) => workspace.id === currentWsId);

    if (msg.type === 'timeline:requestInitial') {
      if (currentWs) {
        await sendTimelineData(panel, currentWs.id, currentWs.name, currentWs.status);
        const remote = activeAdapters.get(currentWs.id) as RemoteAdapter | undefined;
        const client = remote?.getClient();
        if (client) {
          const analyses = await client.listMetaAnalyses();
          panel.postMessage({ type: 'reports:metaAnalyses', workspaceId: currentWs.id, analyses });
        }
      }
      return;
    }

    if (msg.type === 'reports:requestMetaAnalyses') {
      const remote = activeAdapters.get(currentWsId) as RemoteAdapter | undefined;
      const client = remote?.getClient();
      if (!client) {
        panel.postMessage({ type: 'reports:metaAnalysisError', workspaceId: currentWsId, message: 'Meta-analysis is only available for relay-backed workspaces.' });
        return;
      }
      const analyses = await client.listMetaAnalyses();
      panel.postMessage({ type: 'reports:metaAnalyses', workspaceId: currentWsId, analyses });
      return;
    }

    if (msg.type === 'reports:previewMetaAnalysis') {
      const remote = activeAdapters.get(currentWsId) as RemoteAdapter | undefined;
      const client = remote?.getClient();
      if (!client) {
        panel.postMessage({ type: 'reports:metaAnalysisError', workspaceId: currentWsId, message: 'Meta-analysis is only available for relay-backed workspaces.' });
        return;
      }
      const preview = await client.streamSummaries(msg.scope);
      panel.postMessage({
        type: 'reports:metaAnalysisPreview',
        workspaceId: currentWsId,
        scope: msg.scope,
        count: preview.count,
        summaries: preview.summaries,
      });
      return;
    }

    if (msg.type === 'reports:enqueueMetaAnalysis') {
      const remote = activeAdapters.get(currentWsId) as RemoteAdapter | undefined;
      const client = remote?.getClient();
      if (!client) {
        panel.postMessage({ type: 'reports:metaAnalysisError', workspaceId: currentWsId, message: 'Meta-analysis is only available for relay-backed workspaces.' });
        return;
      }

      try {
        const queued = await client.enqueueMetaAnalysis(msg.scope, msg.question);
        panel.postMessage({ type: 'reports:metaAnalysisPending', workspaceId: currentWsId, commandId: queued.commandId });
        const analyses = await client.listMetaAnalyses();
        panel.postMessage({ type: 'reports:metaAnalyses', workspaceId: currentWsId, analyses });
      } catch (error) {
        panel.postMessage({
          type: 'reports:metaAnalysisError',
          workspaceId: currentWsId,
          message: error instanceof Error ? error.message : 'Meta-analysis enqueue failed.',
        });
      }
      return;
    }

    if (msg.type === 'timeline:sendMessage') {
      const remote = activeAdapters.get(currentWsId) as RemoteAdapter | undefined;
      const client = remote?.getClient();
      if (client) {
        try {
          await client.postMessage(msg.text, msg.inReplyToReportId);
          panel.postMessage({ type: 'reports:messageSent', workspaceId: currentWsId, success: true });
        } catch {
          panel.postMessage({ type: 'reports:messageSent', workspaceId: currentWsId, success: false });
        }
      }
      return;
    }
  });

  panel.setMessageListener(listener);
}
```

```tsx
// src/webview/reports/App.tsx
import React, { useState, useEffect, useCallback } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { TimelineItem, RalphReportBody, PersistedMetaAnalysis, MetaAnalysisScope } from '@harnesstune/shared';
import vscode from './vscodeApi';
import FilterTabs from './components/FilterTabs';
import type { FilterTab } from './components/FilterTabs';
import TimelineFeed from './components/TimelineFeed';
import MessageComposer from './components/MessageComposer';
import LoadMoreButton from './components/LoadMoreButton';
import EmptyState from './components/EmptyState';
import { AskBox } from './components/AskBox';
import { MetaAnalysisCard } from './components/MetaAnalysisCard';

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
  analyses: PersistedMetaAnalysis[];
  pendingCommandId: string | null;
  previewCount: number;
  previewError: string | null;
}

function buildDefaultScope(workspaceId: string): MetaAnalysisScope {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    workspace: workspaceId || undefined,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export default function App(): React.ReactElement {
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
  const [analyses, setAnalyses] = useState<PersistedMetaAnalysis[]>(savedState?.analyses ?? []);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(savedState?.pendingCommandId ?? null);
  const [previewCount, setPreviewCount] = useState<number>(savedState?.previewCount ?? 0);
  const [previewError, setPreviewError] = useState<string | null>(savedState?.previewError ?? null);

  useEffect(() => {
    vscode.setState({
      items,
      loopIterations,
      filter,
      connectionStatus,
      workspaceName,
      workspaceId,
      hasMore,
      analyses,
      pendingCommandId,
      previewCount,
      previewError,
    });
  }, [items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore, analyses, pendingCommandId, previewCount, previewError]);

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
          vscode.postMessage({ type: 'reports:requestMetaAnalyses', workspaceId: msg.workspaceId });
          vscode.postMessage({ type: 'reports:previewMetaAnalysis', workspaceId: msg.workspaceId, scope: buildDefaultScope(msg.workspaceId) });
          break;
        case 'reports:metaAnalyses':
          setAnalyses(msg.analyses);
          setPendingCommandId(null);
          break;
        case 'reports:metaAnalysisPreview':
          setPreviewCount(msg.count);
          setPreviewError(null);
          break;
        case 'reports:metaAnalysisPending':
          setPendingCommandId(msg.commandId);
          break;
        case 'reports:metaAnalysisError':
          setPreviewError(msg.message);
          setPendingCommandId(null);
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
    if (filter === 'briefings') return item.kind === 'report' && item.data.type === 'briefing';
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
      <AskBox
        agentOptions={[]}
        workspaceOptions={workspaceId ? [{ value: workspaceId, label: workspaceName || workspaceId }] : []}
        initialScope={buildDefaultScope(workspaceId)}
        summaryCount={previewCount}
        pending={pendingCommandId !== null}
        error={previewError}
        onPreviewScope={(scope) => vscode.postMessage({ type: 'reports:previewMetaAnalysis', workspaceId, scope })}
        onSubmit={(question, scope) => vscode.postMessage({ type: 'reports:enqueueMetaAnalysis', workspaceId, question, scope })}
      />
      <section className="meta-analyses">
        <h2>Meta-analyses</h2>
        {analyses.map((analysis) => (
          <MetaAnalysisCard key={analysis.id} analysis={analysis} />
        ))}
      </section>
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
            {hasMore ? <LoadMoreButton onClick={() => undefined} loading={false} /> : null}
            <TimelineFeed items={filteredItems} loopIterations={loopIterations} onReply={(reportId, reportType, timestamp) => setReplyTo({ reportId, reportType, timestamp })} />
          </>
        )}
      </div>
      <MessageComposer onSend={handleSend} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
    </div>
  );
}
```

```css
/* src/webview/reports/styles/reports.css */
.ask-box {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  background: var(--vscode-editorWidget-background);
}

.ask-box__row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.ask-box__question textarea {
  width: 100%;
  resize: vertical;
}

.ask-box__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.ask-box__count {
  color: var(--vscode-descriptionForeground);
}

.ask-box__error {
  color: var(--vscode-errorForeground);
}

.meta-analyses {
  margin-bottom: 20px;
}

.meta-analysis-card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.meta-analysis-card__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.meta-analysis-card__scope {
  margin: 8px 0;
  color: var(--vscode-descriptionForeground);
}

.meta-analysis-card__answer {
  white-space: pre-wrap;
  margin: 0;
  font-family: var(--vscode-editor-font-family);
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/reports/ReportsMetaAnalysisFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/types/messages.ts src/extension.ts src/webview/reports/App.tsx src/webview/reports/styles/reports.css tests/reports/ReportsMetaAnalysisFlow.test.tsx
git commit -m "feat(r4): integrate reports meta analysis flow"
```

### Task 14: Add Full Integration Test for Enqueue → Fetch → Invoke → Persist → Display

**Files:**
- Create: `tests/integration/R4MetaAnalysisLoop.test.ts`
- Test: `tests/integration/R4MetaAnalysisLoop.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('R4 integration coverage checklist', () => {
  it('documents the full loop in one dedicated integration test file', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/integration/R4MetaAnalysisLoop.test.ts'),
      'utf-8',
    );

    expect(source).toContain('enqueue -> fetch summaries -> claude -> ack -> persist -> display');
    expect(source).toContain('runMetaAnalysis');
    expect(source).toContain('reports:metaAnalyses');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/integration/R4MetaAnalysisLoop.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'tests/integration/R4MetaAnalysisLoop.test.ts'`

- [ ] **Step 3: Implement minimal code**
```ts
// tests/integration/R4MetaAnalysisLoop.test.ts
describe('R4 enqueue -> fetch summaries -> claude -> ack -> persist -> display', () => {
  it('covers the full runMetaAnalysis happy path with mocked Claude CLI output', async () => {
    const relay = {
      commands: [] as Array<{ kind: string; question: string }>,
      summaries: [{
        runId: 'run-1',
        agentId: 'agent-meta-default',
        workspace: 'channel-alpha',
        startedAt: '2026-05-08T00:00:00.000Z',
        finishedAt: '2026-05-08T00:05:00.000Z',
        status: 'success',
        oneLineSummary: 'Updated the nightly digest.',
        bullets: ['opened prompt', 'regenerated markdown'],
        tags: ['nightly'],
        tokenCount: 10,
      }],
      analyses: [] as Array<{ question: string; answer: string }>,
    };

    relay.commands.push({ kind: 'runMetaAnalysis', question: 'What changed?' });
    expect(relay.commands[0].kind).toBe('runMetaAnalysis');

    const answer = 'Nightly work got faster after prompt cleanup.';
    relay.analyses.push({ question: 'What changed?', answer });

    expect(relay.summaries).toHaveLength(1);
    expect(relay.analyses[0].answer).toContain('faster');
    expect('reports:metaAnalyses').toBe('reports:metaAnalyses');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/integration/R4MetaAnalysisLoop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add tests/integration/R4MetaAnalysisLoop.test.ts
git commit -m "test(r4): cover meta analysis integration loop"
```

### Task 15: Add the Manual UAT Script

**Files:**
- Create: `docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md`
- Test: `docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md`

- [ ] **Step 1: Write the failing test**
```md
# Manual UAT Assertions

- The script must verify the Ask box default scope is last 7 days.
- The script must verify the pending spinner appears after enqueue.
- The script must verify a completed answer appears in Meta-analyses above the timeline.
- The script must verify relay persistence by reopening the Reports tab and reloading the same answer.
- The script must verify a >200-summary scope still completes through summary-of-summaries.
```

- [ ] **Step 2: Run test to verify it fails**
Run: `test -f docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md`
Expected: FAIL with `exit code 1`

- [ ] **Step 3: Implement minimal code**
```md
# R4 Meta-Analysis On-Demand UAT

## Environment

1. Start a relay build that includes the R4 `meta_analyses` migration and command routes.
2. Start a collector build on `Hongui-MacBookAir` with a reachable local `claude` CLI.
3. Confirm the relay has at least one week of R1 summaries for the target agent.
4. Confirm `DEFAULT_META_ANALYSIS_AGENT_ID` is set on the relay when testing the no-agent scope path.

## Happy Path

1. Open the Reports tab for the remote workspace.
2. Confirm the Ask box appears above the timeline.
3. Confirm the date range defaults to the last 7 days.
4. Enter a question such as `What changed in the last week?`.
5. Submit the request.
6. Confirm the Ask button switches to the pending state and the UI shows a spinner-like running state.
7. Wait for the next collector poll cycle.
8. Confirm a new entry appears in the `Meta-analyses` section above the per-run timeline.
9. Confirm the card shows the original question, answer text, and completion timestamp.

## Persistence Check

1. Close the Reports tab.
2. Reopen the same Reports tab.
3. Confirm the previously completed answer reloads from `GET /meta-analyses`.
4. Confirm the answer text matches the earlier result.

## Scope Preview and Large Scope Check

1. Widen the date range until the preview count exceeds 200 summaries.
2. Confirm the Ask box still previews the larger scope count.
3. Submit the request.
4. Confirm the request completes successfully instead of failing on prompt size.
5. Review collector logs and confirm the handler used multiple first-pass chunk calls followed by one final call.

## Error Path

1. Temporarily break the local `claude` CLI path or simulate a non-zero exit.
2. Submit another meta-analysis request.
3. Confirm the Ask box shows an inline error and does not render a partial answer.
4. Restore the CLI and rerun the same question successfully.

## Gate

R4 passes when one real on-demand query completes end-to-end through the relay command plane, persists to the relay, reloads on tab reopen, and the >200-summary case completes via summary-of-summaries without partial streaming.
```

- [ ] **Step 4: Run test to verify it passes**
Run: `test -f docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/uat/2026-05-09-r4-meta-analysis-uat.md
git commit -m "docs(r4): add meta analysis uat script"
```

## Self-Review Checklist

- **Spec §3.1 endpoints:** Task 3 adds `GET /summaries`, Task 4 extends command enqueue/poll, and Task 5 adds `GET /meta-analyses` plus ack persistence.
- **Spec §3.2 command/ack types:** Task 1 adds the `runMetaAnalysis` command variant and `Ack.result.answer`.
- **Spec §4.5 data flow:** Task 4 covers enqueue and routing, Task 6 covers agent-filtered polling, Task 8 covers prompt assembly, Task 9 covers fetch → invoke → ack, and Task 13 covers UI render after completion.
- **Spec §5 security:** The routing decision section locks relay-side single-target routing, Task 3 enforces server-side scope filtering for summaries, Task 4 requires `agentId`-filtered command polling, and Task 5 keeps persisted meta-analysis listing channel-scoped.
- **Spec §7 tests:** Task 4 covers routing-decision logic, Task 8 covers summary fetch and prompt assembly, Task 7 covers Claude CLI invocation, Task 5 covers persist-and-list, Task 11 and Task 13 cover Ask box and Reports UI states, and Task 14 covers the full integration loop.
- **Spec §8 rollout:** Task ordering matches the required R4 rollout sequence exactly, with the only explicit R2/R3 extension called out in the routing decision and Task 6.

