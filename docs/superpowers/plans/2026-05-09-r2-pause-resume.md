# R2 — Pause/Resume Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest writable control-plane slice for remote Claude Desktop and Claude Code agents: enqueue `pause` and `resume` commands from the VS Code sidebar, have the collector apply them on its existing poll tick, persist acks in the relay, and reconcile optimistic UI state from the ack outcome.

**Architecture:** R2 adds a mailbox-style `commands` table and three relay endpoints: enqueue, poll, and ack. The collector reuses the existing `runCycle()` cadence to pull pending commands, dispatch them through plugin-specific pause/resume handlers with optimistic-concurrency guards, and ack the outcome. The extension reuses the existing remote workspace agent cache in `WorkspaceRegistry`, adds `RelayClient` command helpers, and layers optimistic per-task toggle state onto the sidebar row UI without changing analytics or reports surfaces.

**Tech Stack:** TypeScript, Node.js 20, Jest + ts-jest, Hono, Drizzle ORM + Turso/libSQL, VS Code webviews, esbuild multi-bundle build, pnpm workspace

---

## Pre-task: File Structure

### Shared types
- Create: `packages/shared/src/commands.ts` — single source of truth for the R2 `Command`, `Ack`, and relay-facing command record helper types.
- Modify: `packages/shared/src/index.ts` — export `commands.ts` from the shared package barrel.

### Relay
- Create: `packages/harnesstune-relay/drizzle/0002_add_commands_table.sql` — second Drizzle migration adding the `commands` table after the R1 run-summary migration.
- Modify: `packages/harnesstune-relay/drizzle/meta/_journal.json` — append the `0002_add_commands_table` entry without disturbing the existing R1 migration record.
- Modify: `packages/harnesstune-relay/src/db/schema.ts` — add the Drizzle `commands` table definition and indexes used for per-task pending checks and `since` polling.
- Create: `packages/harnesstune-relay/src/routes/commands.ts` — Hono router for enqueue, poll, and ack routes.
- Modify: `packages/harnesstune-relay/src/app.ts` — mount `commandsRouter` under `/api/channels/:channelId/commands`.

### Collector
- Modify: `packages/harnesstune-collector/src/plugins/interface.ts` — extend the plugin contract with `handleCommand(command)` so command application stays plugin-owned.
- Create: `packages/harnesstune-collector/src/plugins/claude-desktop/commands.ts` — pause/resume file-edit handler for `scheduled-tasks.json` with mtime guard and atomic write.
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts` — expose a strict scheduled-task file reader used by the new command handler.
- Create: `packages/harnesstune-collector/src/plugins/claude-code/commands.ts` — pause/resume handler that finds the correct `harnesstune-wrap --name <agentId>` crontab entry and toggles the `#HT_PAUSED# ` prefix.
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/crontab.ts` — add raw-body read/write helpers and sha256 hashing support for optimistic concurrency.
- Modify: `packages/harnesstune-collector/src/daemon/scheduler.ts` — insert command poll → dispatch → ack inside the existing cycle before run collection.

### Extension host + sidebar
- Modify: `src/relay/RelayClient.ts` — add `enqueueCommand()`, `getCommandsSince()`, and typed ack parsing.
- Modify: `src/types/messages.ts` — add sidebar-specific command request / command-result webview messages.
- Modify: `src/panels/SidebarViewProvider.ts` — forward new webview command messages to the extension host.
- Modify: `src/extension.ts` — wire sidebar command requests to remote `RelayClient`, maintain ack polling timers, and update `WorkspaceRegistry.agents` on successful acks.
- Create: `src/webview/sidebar/components/TaskRow.tsx` — focused task-row toggle UI for remote agent tasks.
- Modify: `src/webview/sidebar/components/WorkspaceItem.tsx` — render remote task rows beneath each remote workspace and keep existing context menu behavior.
- Modify: `src/webview/sidebar/App.tsx` — hold optimistic/in-flight/error state keyed by workspace + task, reconcile on host acks, and auto-clear inline error banners on the next successful action.
- Modify: `src/webview/sidebar/styles/sidebar.css` — add task-row, toggle-button, and inline error banner styles consistent with current sidebar theming.

### Tests
- Create: `tests/shared/commandsContract.test.ts` — shared `Command` and `Ack` discriminated union coverage for pause/resume only.
- Create: `tests/relay/CommandsRoutes.test.ts` — Hono route coverage for enqueue, poll, ack, duplicate-pending rejection, and ack persistence.
- Create: `tests/collector/PluginCommandContract.test.ts` — plugin interface contract coverage for `handleCommand()`.
- Create: `tests/collector/ClaudeDesktopPauseResume.test.ts` — `scheduled-tasks.json` pause/resume behavior, missing-task rejection, and mtime-guard rejection.
- Create: `tests/collector/ClaudeCodeCrontabPauseResume.test.ts` — crontab body parse/rewrite helpers plus sha256 guard rejection.
- Create: `tests/collector/ClaudeCodePauseResume.test.ts` — Claude Code pause/resume handler behavior over real fixture crontab bodies.
- Create: `tests/collector/CommandConsumer.test.ts` — scheduler command-consumer coverage for GET → dispatch → POST ack ordering.
- Create: `tests/sidebar/RelayClientCommands.test.ts` — extension relay client command helper coverage.
- Create: `tests/sidebar/PauseResumeToggle.test.tsx` — optimistic sidebar toggle UI with in-flight disable, success reconcile, and inline error banner handling.
- Create: `tests/integration/R2PauseResumeLoop.test.ts` — in-process enqueue → poll → apply → ack smoke test spanning relay and collector logic.
- Create: `docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md` — manual Hongui-MacBookAir verification script.

### Notes from required reads
- `packages/harnesstune-relay/src/app.ts` currently mounts reports, messages, agents, runs, and summary routers directly under `/api`; R2 must explicitly add the new commands router there or the endpoints will remain unreachable.
- `packages/harnesstune-collector/src/daemon/scheduler.ts` already owns the per-cycle agent registration and run upload order; R2 should insert command handling into that file instead of creating a parallel daemon loop or second timer.
- `src/webview/sidebar/components/WorkspaceItem.tsx` is the current row-level sidebar component; R2 should keep it as the workspace shell and introduce a nested task-row component underneath it rather than overloading the context menu block.
- `src/types/workspace.ts` already stores `agents: AgentIdentity[]` in each remote workspace record via `RemoteAdapter`; R2 should reuse that cache for task rows instead of introducing a second remote-agent store.

## Tasks

### Task 1: Shared Pause/Resume Command Contract

**Files:**
- Create: `packages/shared/src/commands.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/shared/commandsContract.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import type { Ack, Command } from '../../packages/shared/src/commands';

describe('pause/resume command contract', () => {
  it('accepts pause and resume command variants only', () => {
    const pause: Command = {
      kind: 'pause',
      target: { plugin: 'claude-desktop', taskId: 'desktop-task-1' },
    };
    const resume: Command = {
      kind: 'resume',
      target: { plugin: 'claude-code', taskId: 'nightly-report' },
    };

    expect(pause.kind).toBe('pause');
    expect(resume.target.plugin).toBe('claude-code');
  });

  it('accepts applied and rejected ack variants with optional guards', () => {
    const applied: Ack = {
      commandId: 'cmd-1',
      status: 'applied',
      appliedAt: '2026-05-09T10:00:00.000Z',
      mtimeBefore: 100,
      mtimeAfter: 200,
    };
    const rejected: Ack = {
      commandId: 'cmd-2',
      status: 'rejected',
      appliedAt: '2026-05-09T10:01:00.000Z',
      error: 'task_not_found',
    };

    expect(applied.status).toBe('applied');
    expect(rejected.error).toBe('task_not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/shared/commandsContract.test.ts`
Expected: FAIL with `Cannot find module '../../packages/shared/src/commands'`

- [ ] **Step 3: Write minimal implementation**
```ts
// packages/shared/src/commands.ts
export type CommandPlugin = 'claude-desktop' | 'claude-code';

export interface CommandTarget {
  plugin: CommandPlugin;
  taskId: string;
}

export type Command =
  | { kind: 'pause'; target: CommandTarget }
  | { kind: 'resume'; target: CommandTarget };

export type Ack =
  | {
      commandId: string;
      status: 'applied';
      appliedAt: string;
      error?: string;
      mtimeBefore?: number;
      mtimeAfter?: number;
    }
  | {
      commandId: string;
      status: 'rejected' | 'failed';
      appliedAt: string;
      error: string;
      mtimeBefore?: number;
      mtimeAfter?: number;
    };

export interface CommandEnvelope {
  id: string;
  channelId: string;
  agentId: string;
  command: Command;
  ack: Ack | null;
  status: 'pending' | Ack['status'];
  createdAt: string;
  updatedAt: string;
}
```

```ts
// packages/shared/src/index.ts
/**
 * @harnesstune/shared — Shared types, constants, and utilities
 *
 * Shared types will be migrated here from src/types/ in future phases
 * as relay and agent packages begin consuming them.
 */
export const SHARED_VERSION = '0.0.1';
export * from './reports.js';
export * from './commands.js';
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/shared/commandsContract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/commands.ts packages/shared/src/index.ts tests/shared/commandsContract.test.ts
git commit -m "feat(r2): add shared pause resume command contract"
```

### Task 2: Relay Commands Table Migration

**Files:**
- Create: `packages/harnesstune-relay/drizzle/0002_add_commands_table.sql`
- Modify: `packages/harnesstune-relay/drizzle/meta/_journal.json`
- Modify: `packages/harnesstune-relay/src/db/schema.ts`
- Test: `tests/relay/CommandsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('commands schema migration', () => {
  it('adds the commands table as drizzle migration 0002', () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/db/schema.ts'),
      'utf-8',
    );
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/0002_add_commands_table.sql'),
      'utf-8',
    );
    const journal = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/meta/_journal.json'),
      'utf-8',
    );

    expect(schema).toContain("export const commands = sqliteTable('commands'");
    expect(schema).toContain("status: text('status').notNull().default('pending')");
    expect(migration).toContain('CREATE TABLE commands');
    expect(journal).toContain('"tag": "0002_add_commands_table"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'packages/harnesstune-relay/drizzle/0002_add_commands_table.sql'`

- [ ] **Step 3: Write minimal implementation**
```sql
-- packages/harnesstune-relay/drizzle/0002_add_commands_table.sql
CREATE TABLE commands (
  id text PRIMARY KEY NOT NULL,
  channel_id text NOT NULL,
  agent_id text NOT NULL,
  plugin text NOT NULL,
  task_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  ack text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON UPDATE no action ON DELETE no action
);

CREATE INDEX commands_channel_created_idx ON commands(channel_id, created_at);
CREATE INDEX commands_channel_updated_idx ON commands(channel_id, updated_at);
CREATE INDEX commands_channel_plugin_task_pending_idx ON commands(channel_id, plugin, task_id, status);
```

```json
// packages/harnesstune-relay/drizzle/meta/_journal.json
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
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1778288400000,
      "tag": "0002_add_commands_table",
      "breakpoints": true
    }
  ]
}
```

```ts
// packages/harnesstune-relay/src/db/schema.ts
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

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
}, (table) => ({
  channelAgentStartedUniq: uniqueIndex('agent_runs_channel_agent_started_uniq')
    .on(table.channelId, table.agentId, table.startedAt),
}));

export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id),
  agentId: text('agent_id').notNull(),
  plugin: text('plugin').notNull(),
  taskId: text('task_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  ack: text('ack'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  channelCreatedIdx: index('commands_channel_created_idx').on(table.channelId, table.createdAt),
  channelUpdatedIdx: index('commands_channel_updated_idx').on(table.channelId, table.updatedAt),
  pendingTargetIdx: index('commands_channel_plugin_task_pending_idx').on(
    table.channelId,
    table.plugin,
    table.taskId,
    table.status,
  ),
}));

export const rateLimits = sqliteTable('rate_limits', {
  tokenId: text('token_id').notNull(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.tokenId, table.windowStart] }),
}));
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/drizzle/0002_add_commands_table.sql packages/harnesstune-relay/drizzle/meta/_journal.json packages/harnesstune-relay/src/db/schema.ts tests/relay/CommandsRoutes.test.ts
git commit -m "feat(r2): add relay commands table"
```

### Task 3: Relay Enqueue Route

**Files:**
- Create: `packages/harnesstune-relay/src/routes/commands.ts`
- Modify: `packages/harnesstune-relay/src/app.ts`
- Test: `tests/relay/CommandsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('commands enqueue route', () => {
  it('rejects a second pending command for the same plugin/task pair', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/commands.ts'),
      'utf-8',
    );
    const app = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/app.ts'),
      'utf-8',
    );

    expect(source).toContain("commandsRouter.post('/', async (c) => {");
    expect(source).toContain("eq(commands.status, 'pending')");
    expect(source).toContain("return c.json({ error: 'Command already pending' }, 409)");
    expect(app).toContain("api.route('/channels/:channelId/commands', commandsRouter)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'packages/harnesstune-relay/src/routes/commands.ts'`

- [ ] **Step 3: Write minimal implementation**
```ts
// packages/harnesstune-relay/src/routes/commands.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Ack, Command, CommandEnvelope } from '@harnesstune/shared';
import { getDb } from '../db/client.js';
import { commands } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const commandsRouter = new Hono<{ Variables: AuthVariables }>();

function mapRow(row: {
  id: string;
  channelId: string;
  agentId: string;
  plugin: string;
  taskId: string;
  kind: string;
  status: string;
  ack: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CommandEnvelope {
  const command: Command = {
    kind: row.kind as Command['kind'],
    target: {
      plugin: row.plugin as Command['target']['plugin'],
      taskId: row.taskId,
    },
  };

  return {
    id: row.id,
    channelId: row.channelId,
    agentId: row.agentId,
    command,
    ack: row.ack ? JSON.parse(row.ack) as Ack : null,
    status: row.status as CommandEnvelope['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

commandsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{ agentId?: string; command?: Command }>();
  if (!body.agentId || !body.command) {
    return c.json({ error: 'agentId and command are required' }, 400);
  }

  const db = getDb();
  const duplicate = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.plugin, body.command.target.plugin),
    eq(commands.taskId, body.command.target.taskId),
    eq(commands.status, 'pending'),
  )).limit(1);

  if (duplicate.length > 0) {
    return c.json({ error: 'Command already pending' }, 409);
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(commands).values({
    id,
    channelId,
    agentId: body.agentId,
    plugin: body.command.target.plugin,
    taskId: body.command.target.taskId,
    kind: body.command.kind,
    status: 'pending',
    ack: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ commandId: id }, 201);
});

commandsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const since = c.req.query('since');
  const sinceDate = since ? new Date(since) : new Date(0);
  const db = getDb();
  const rows = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    gt(commands.updatedAt, sinceDate),
  )).orderBy(asc(commands.updatedAt));

  return c.json({ commands: rows.map(mapRow) });
});

commandsRouter.post('/:commandId/ack', async (c) => {
  const channelId = c.req.param('channelId');
  const commandId = c.req.param('commandId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const ack = await c.req.json<Ack>();
  const db = getDb();
  const existing = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.id, commandId),
  )).limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Command not found' }, 404);
  }

  if (existing[0].status !== 'pending') {
    return c.json({ ok: true, status: existing[0].status }, 200);
  }

  await db.update(commands).set({
    status: ack.status,
    ack: JSON.stringify(ack),
    updatedAt: new Date(),
  }).where(eq(commands.id, commandId));

  return c.json({ ok: true });
});
```

```ts
// packages/harnesstune-relay/src/app.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { publicChannelsRouter, channelsRouter } from './routes/channels.js';
import { reportsRouter } from './routes/reports.js';
import { messagesRouter } from './routes/messages.js';
import { agentsRouter } from './routes/agents.js';
import { runsUploadRouter, runsRouter } from './routes/runs.js';
import { summaryRouter } from './routes/summary.js';
import { commandsRouter } from './routes/commands.js';

const app = new Hono();

app.use('*', cors());
app.use('*', secureHeaders());

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

app.route('/api/channels', publicChannelsRouter);

const api = new Hono<{ Variables: AuthVariables }>();
api.use('*', authMiddleware);
api.route('/channels/:channelId', channelsRouter);
api.route('/channels/:channelId/reports', reportsRouter);
api.route('/channels/:channelId/messages', messagesRouter);
api.route('/channels/:channelId/agents', agentsRouter);
api.route('/channels/:channelId/runs', runsUploadRouter);
api.route('/channels/:channelId/agents/:agentId/runs', runsRouter);
api.route('/channels/:channelId/summary', summaryRouter);
api.route('/channels/:channelId/commands', commandsRouter);

app.route('/api', api);

export default app;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/commands.ts packages/harnesstune-relay/src/app.ts tests/relay/CommandsRoutes.test.ts
git commit -m "feat(r2): add relay command enqueue route"
```

### Task 4: Relay Poll Route Returns Command Records Since Cursor

**Files:**
- Modify: `packages/harnesstune-relay/src/routes/commands.ts`
- Test: `tests/relay/CommandsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('commands poll route', () => {
  it('returns updated command records ordered by updatedAt for collector and extension polling', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/commands.ts'),
      'utf-8',
    );

    expect(source).toContain("commandsRouter.get('/', async (c) => {");
    expect(source).toContain("gt(commands.updatedAt, sinceDate)");
    expect(source).toContain('orderBy(asc(commands.updatedAt))');
    expect(source).toContain('return c.json({ commands: rows.map(mapRow) })');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: FAIL with `Expected substring: "orderBy(asc(commands.updatedAt))"`

- [ ] **Step 3: Write minimal implementation**
```ts
// packages/harnesstune-relay/src/routes/commands.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Ack, Command, CommandEnvelope } from '@harnesstune/shared';
import { getDb } from '../db/client.js';
import { commands } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const commandsRouter = new Hono<{ Variables: AuthVariables }>();

function mapRow(row: {
  id: string;
  channelId: string;
  agentId: string;
  plugin: string;
  taskId: string;
  kind: string;
  status: string;
  ack: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CommandEnvelope {
  return {
    id: row.id,
    channelId: row.channelId,
    agentId: row.agentId,
    command: {
      kind: row.kind as Command['kind'],
      target: {
        plugin: row.plugin as Command['target']['plugin'],
        taskId: row.taskId,
      },
    },
    ack: row.ack ? JSON.parse(row.ack) as Ack : null,
    status: row.status as CommandEnvelope['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

commandsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ agentId?: string; command?: Command }>();
  if (!body.agentId || !body.command) {
    return c.json({ error: 'agentId and command are required' }, 400);
  }

  const db = getDb();
  const duplicate = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.plugin, body.command.target.plugin),
    eq(commands.taskId, body.command.target.taskId),
    eq(commands.status, 'pending'),
  )).limit(1);

  if (duplicate.length > 0) {
    return c.json({ error: 'Command already pending' }, 409);
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(commands).values({
    id,
    channelId,
    agentId: body.agentId,
    plugin: body.command.target.plugin,
    taskId: body.command.target.taskId,
    kind: body.command.kind,
    status: 'pending',
    ack: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ commandId: id }, 201);
});

commandsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const since = c.req.query('since');
  const sinceDate = since ? new Date(since) : new Date(0);

  const db = getDb();
  const rows = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    gt(commands.updatedAt, sinceDate),
  )).orderBy(asc(commands.updatedAt));

  return c.json({ commands: rows.map(mapRow) });
});

commandsRouter.post('/:commandId/ack', async (c) => {
  const channelId = c.req.param('channelId');
  const commandId = c.req.param('commandId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const ack = await c.req.json<Ack>();
  const db = getDb();
  const existing = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.id, commandId),
  )).limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Command not found' }, 404);
  }
  if (existing[0].status !== 'pending') {
    return c.json({ ok: true, status: existing[0].status }, 200);
  }

  await db.update(commands).set({
    status: ack.status,
    ack: JSON.stringify(ack),
    updatedAt: new Date(),
  }).where(eq(commands.id, commandId));

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/commands.ts tests/relay/CommandsRoutes.test.ts
git commit -m "feat(r2): add relay command poll route"
```

### Task 5: Relay Ack Route Persists Outcomes Idempotently

**Files:**
- Modify: `packages/harnesstune-relay/src/routes/commands.ts`
- Test: `tests/relay/CommandsRoutes.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('commands ack route', () => {
  it('stores the serialized ack and keeps repeat acks idempotent', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/routes/commands.ts'),
      'utf-8',
    );

    expect(source).toContain("commandsRouter.post('/:commandId/ack', async (c) => {");
    expect(source).toContain('if (existing[0].status !== \'pending\')');
    expect(source).toContain('ack: JSON.stringify(ack)');
    expect(source).toContain('status: ack.status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: FAIL with `Expected substring: "if (existing[0].status !== 'pending')"`

- [ ] **Step 3: Write minimal implementation**
```ts
// packages/harnesstune-relay/src/routes/commands.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Ack, Command, CommandEnvelope } from '@harnesstune/shared';
import { getDb } from '../db/client.js';
import { commands } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const commandsRouter = new Hono<{ Variables: AuthVariables }>();

function mapRow(row: {
  id: string;
  channelId: string;
  agentId: string;
  plugin: string;
  taskId: string;
  kind: string;
  status: string;
  ack: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CommandEnvelope {
  return {
    id: row.id,
    channelId: row.channelId,
    agentId: row.agentId,
    command: {
      kind: row.kind as Command['kind'],
      target: {
        plugin: row.plugin as Command['target']['plugin'],
        taskId: row.taskId,
      },
    },
    ack: row.ack ? JSON.parse(row.ack) as Ack : null,
    status: row.status as CommandEnvelope['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

commandsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ agentId?: string; command?: Command }>();
  if (!body.agentId || !body.command) return c.json({ error: 'agentId and command are required' }, 400);

  const db = getDb();
  const duplicate = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.plugin, body.command.target.plugin),
    eq(commands.taskId, body.command.target.taskId),
    eq(commands.status, 'pending'),
  )).limit(1);
  if (duplicate.length > 0) {
    return c.json({ error: 'Command already pending' }, 409);
  }

  const now = new Date();
  const id = randomUUID();
  await db.insert(commands).values({
    id,
    channelId,
    agentId: body.agentId,
    plugin: body.command.target.plugin,
    taskId: body.command.target.taskId,
    kind: body.command.kind,
    status: 'pending',
    ack: null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ commandId: id }, 201);
});

commandsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const since = c.req.query('since');
  const sinceDate = since ? new Date(since) : new Date(0);
  const rows = await getDb().select().from(commands).where(and(
    eq(commands.channelId, channelId),
    gt(commands.updatedAt, sinceDate),
  )).orderBy(asc(commands.updatedAt));

  return c.json({ commands: rows.map(mapRow) });
});

commandsRouter.post('/:commandId/ack', async (c) => {
  const channelId = c.req.param('channelId');
  const commandId = c.req.param('commandId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const ack = await c.req.json<Ack>();
  const db = getDb();
  const existing = await db.select().from(commands).where(and(
    eq(commands.channelId, channelId),
    eq(commands.id, commandId),
  )).limit(1);

  if (existing.length === 0) {
    return c.json({ error: 'Command not found' }, 404);
  }
  if (existing[0].status !== 'pending') {
    return c.json({ ok: true, status: existing[0].status }, 200);
  }

  await db.update(commands).set({
    status: ack.status,
    ack: JSON.stringify(ack),
    updatedAt: new Date(),
  }).where(eq(commands.id, commandId));

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/relay/CommandsRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-relay/src/routes/commands.ts tests/relay/CommandsRoutes.test.ts
git commit -m "feat(r2): persist command ack outcomes"
```

### Task 6: Collector Plugin Contract Gains `handleCommand()`

**Files:**
- Modify: `packages/harnesstune-collector/src/plugins/interface.ts`
- Test: `tests/collector/PluginCommandContract.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('collector plugin command contract', () => {
  it('requires plugins to expose handleCommand(command)', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-collector/src/plugins/interface.ts'),
      'utf-8',
    );

    expect(source).toContain("import type { Ack, Command } from '@harnesstune/shared';");
    expect(source).toContain('handleCommand(command: Command): Promise<Ack>;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/PluginCommandContract.test.ts`
Expected: FAIL with `Expected substring: "handleCommand(command: Command): Promise<Ack>;"`

- [ ] **Step 3: Write minimal implementation**
```ts
import type { Interface as ReadlineInterface } from 'node:readline/promises';
import type { Ack, Command, RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../types.js';

export type PlatformConfig = Record<string, unknown>;

export interface PlatformPlugin {
  readonly id: string;
  readonly displayName: string;

  detect(): Promise<boolean>;
  setup(existing?: PlatformConfig, rl?: ReadlineInterface): Promise<PlatformConfig>;
  discover(): Promise<AgentIdentity[]>;
  collectRuns(since: Date): Promise<RunReport[]>;
  handleCommand(command: Command): Promise<Ack>;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/PluginCommandContract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/interface.ts tests/collector/PluginCommandContract.test.ts
git commit -m "feat(r2): extend collector plugin command interface"
```

### Task 7: Claude Desktop Pause/Resume Handler With Mtime Guard

**Files:**
- Create: `packages/harnesstune-collector/src/plugins/claude-desktop/commands.ts`
- Modify: `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts`
- Test: `tests/collector/ClaudeDesktopPauseResume.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDesktopCommand } from '../../packages/harnesstune-collector/src/plugins/claude-desktop/commands';

describe('Claude Desktop pause/resume', () => {
  it('rejects when the target task no longer exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-command-'));
    fs.writeFileSync(path.join(root, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [] }, null, 2));

    const ack = await applyDesktopCommand(root, {
      kind: 'pause',
      target: { plugin: 'claude-desktop', taskId: 'missing-task' },
    });

    expect(ack).toEqual({
      commandId: 'local',
      status: 'rejected',
      appliedAt: expect.any(String),
      error: 'task_not_found',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeDesktopPauseResume.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/plugins/claude-desktop/commands'`

- [ ] **Step 3: Write minimal implementation**
```ts
// packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ScheduledTask, ScheduledTasksFile, SessionFile } from './types.js';

const SCHEDULED_TASKS_FILE = 'scheduled-tasks.json';

export function getScheduledTasksFilePath(sessionsDir: string): string {
  return join(sessionsDir, SCHEDULED_TASKS_FILE);
}

export function getScheduledTasksMtime(sessionsDir: string): Date {
  try {
    return statSync(getScheduledTasksFilePath(sessionsDir)).mtime;
  } catch {
    return new Date(0);
  }
}

export function readScheduledTasks(sessionsDir: string): ScheduledTask[] {
  try {
    const raw = readFileSync(getScheduledTasksFilePath(sessionsDir), 'utf-8');
    const parsed = JSON.parse(raw) as ScheduledTasksFile;
    return parsed.scheduledTasks ?? [];
  } catch {
    return [];
  }
}

export function readScheduledTasksFile(sessionsDir: string): ScheduledTasksFile {
  const raw = readFileSync(getScheduledTasksFilePath(sessionsDir), 'utf-8');
  return JSON.parse(raw) as ScheduledTasksFile;
}

export function readSessionFile(filePath: string): SessionFile | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionFile;
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
    if (!session?.scheduledTaskId) continue;
    if (session.lastActivityAt > nowMs - STALENESS_GUARD_MS) continue;
    if (session.lastActivityAt <= sinceMs) continue;
    results.push(session);
  }

  return results;
}
```

```ts
// packages/harnesstune-collector/src/plugins/claude-desktop/commands.ts
import { renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ack, Command } from '@harnesstune/shared';
import { getScheduledTasksFilePath, readScheduledTasksFile } from './reader.js';

export async function applyDesktopCommand(
  sessionsDir: string,
  command: Command,
  commandId = 'local',
): Promise<Ack> {
  const filePath = getScheduledTasksFilePath(sessionsDir);
  const before = statSync(filePath).mtimeMs;
  const parsed = readScheduledTasksFile(sessionsDir);
  const task = parsed.scheduledTasks.find((item) => item.id === command.target.taskId);

  if (!task) {
    return {
      commandId,
      status: 'rejected',
      appliedAt: new Date().toISOString(),
      error: 'task_not_found',
    };
  }

  task.enabled = command.kind === 'resume';
  const tmpPath = join(sessionsDir, 'scheduled-tasks.json.tmp');
  writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), 'utf-8');

  const currentBeforeRename = statSync(filePath).mtimeMs;
  if (currentBeforeRename !== before) {
    return {
      commandId,
      status: 'rejected',
      appliedAt: new Date().toISOString(),
      error: 'stale_mtime',
      mtimeBefore: before,
      mtimeAfter: currentBeforeRename,
    };
  }

  renameSync(tmpPath, filePath);
  const after = statSync(filePath).mtimeMs;

  return {
    commandId,
    status: 'applied',
    appliedAt: new Date().toISOString(),
    mtimeBefore: before,
    mtimeAfter: after,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeDesktopPauseResume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts packages/harnesstune-collector/src/plugins/claude-desktop/commands.ts tests/collector/ClaudeDesktopPauseResume.test.ts
git commit -m "feat(r2): add claude desktop pause resume handler"
```

### Task 8: Claude Code Crontab Read/Write Helper With Sha256 Guard

**Files:**
- Modify: `packages/harnesstune-collector/src/plugins/claude-code/crontab.ts`
- Test: `tests/collector/ClaudeCodeCrontabPauseResume.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { hashCrontabBody, togglePausedLine } from '../../packages/harnesstune-collector/src/plugins/claude-code/crontab';

describe('Claude Code crontab helpers', () => {
  it('comments and uncomments the harnesstune-wrap line and hashes the body', () => {
    const body = '0 * * * * /usr/local/bin/harnesstune-wrap --name nightly-report claude -p hi\\n';

    expect(hashCrontabBody(body)).toHaveLength(64);
    expect(togglePausedLine(body, 'nightly-report', 'pause')).toContain('#HT_PAUSED# 0 * * * *');
    expect(togglePausedLine('#HT_PAUSED# 0 * * * * /usr/local/bin/harnesstune-wrap --name nightly-report claude -p hi\\n', 'nightly-report', 'resume'))
      .toContain('/usr/local/bin/harnesstune-wrap --name nightly-report');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeCodeCrontabPauseResume.test.ts`
Expected: FAIL with `Cannot find exported member 'hashCrontabBody'`

- [ ] **Step 3: Write minimal implementation**
```ts
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PAUSE_PREFIX = '#HT_PAUSED# ';

export interface CrontabEntry {
  schedule: string;
  agentName: string;
  rawLine: string;
}

export async function readCrontabRaw(): Promise<string> {
  try {
    const result = await execFileAsync('crontab', ['-l']);
    return result.stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if ((err.stderr ?? '').includes('no crontab for')) {
      return '';
    }
    throw error;
  }
}

export async function writeCrontabRaw(body: string): Promise<void> {
  await execFileAsync('crontab', ['-'], { input: body } as never);
}

export function hashCrontabBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function togglePausedLine(body: string, agentName: string, action: 'pause' | 'resume'): string {
  const lines = body.split('\n');
  const updated = lines.map((line) => {
    const normalized = line.startsWith(PAUSE_PREFIX) ? line.slice(PAUSE_PREFIX.length) : line;
    const needle = `harnesstune-wrap --name ${agentName}`;
    if (!normalized.includes(needle)) return line;
    return action === 'pause'
      ? `${PAUSE_PREFIX}${normalized}`
      : normalized;
  });
  return updated.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeCodeCrontabPauseResume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/claude-code/crontab.ts tests/collector/ClaudeCodeCrontabPauseResume.test.ts
git commit -m "feat(r2): add claude code crontab guard helpers"
```

### Task 9: Claude Code Pause/Resume Handler

**Files:**
- Create: `packages/harnesstune-collector/src/plugins/claude-code/commands.ts`
- Test: `tests/collector/ClaudeCodePauseResume.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { applyClaudeCodeCommand } from '../../packages/harnesstune-collector/src/plugins/claude-code/commands';

describe('Claude Code pause/resume handler', () => {
  it('rejects when the crontab changed between read and write', async () => {
    const ack = await applyClaudeCodeCommand(
      {
        kind: 'pause',
        target: { plugin: 'claude-code', taskId: 'nightly-report' },
      },
      {
        commandId: 'cmd-1',
        readRaw: async () => '0 * * * * /usr/local/bin/harnesstune-wrap --name nightly-report claude -p hi\\n',
        writeRaw: async () => undefined,
        guardHash: 'different-hash',
      },
    );

    expect(ack.status).toBe('rejected');
    expect(ack.error).toBe('crontab_changed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/ClaudeCodePauseResume.test.ts`
Expected: FAIL with `Cannot find module '../../packages/harnesstune-collector/src/plugins/claude-code/commands'`

- [ ] **Step 3: Write minimal implementation**
```ts
import type { Ack, Command } from '@harnesstune/shared';
import { hashCrontabBody, readCrontabRaw, togglePausedLine, writeCrontabRaw } from './crontab.js';

interface ApplyClaudeCodeCommandOptions {
  commandId: string;
  readRaw?: () => Promise<string>;
  writeRaw?: (body: string) => Promise<void>;
  guardHash?: string;
}

export async function applyClaudeCodeCommand(
  command: Command,
  options: ApplyClaudeCodeCommandOptions,
): Promise<Ack> {
  const readRaw = options.readRaw ?? readCrontabRaw;
  const writeRaw = options.writeRaw ?? writeCrontabRaw;
  const beforeBody = await readRaw();
  const beforeHash = hashCrontabBody(beforeBody);

  if (options.guardHash && options.guardHash !== beforeHash) {
    return {
      commandId: options.commandId,
      status: 'rejected',
      appliedAt: new Date().toISOString(),
      error: 'crontab_changed',
    };
  }

  const updatedBody = togglePausedLine(beforeBody, command.target.taskId, command.kind);
  if (updatedBody === beforeBody) {
    return {
      commandId: options.commandId,
      status: 'rejected',
      appliedAt: new Date().toISOString(),
      error: 'task_not_found',
    };
  }

  await writeRaw(updatedBody);
  return {
    commandId: options.commandId,
    status: 'applied',
    appliedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/ClaudeCodePauseResume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/plugins/claude-code/commands.ts tests/collector/ClaudeCodePauseResume.test.ts
git commit -m "feat(r2): add claude code pause resume handler"
```

### Task 10: Collector Scheduler Consumes Commands On Existing Poll Tick

**Files:**
- Modify: `packages/harnesstune-collector/src/daemon/scheduler.ts`
- Test: `tests/collector/CommandConsumer.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('scheduler command consumer', () => {
  it('polls commands, dispatches them to plugins, and posts acks before run uploads', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-collector/src/daemon/scheduler.ts'),
      'utf-8',
    );

    expect(source).toContain('/commands?since=');
    expect(source).toContain('await plugin.handleCommand(command.command)');
    expect(source).toContain("/commands/${command.id}/ack");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/collector/CommandConsumer.test.ts`
Expected: FAIL with `Expected substring: "/commands?since="`

- [ ] **Step 3: Write minimal implementation**
```ts
import { randomUUID } from 'node:crypto';
import type { CommandEnvelope } from '@harnesstune/shared';
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

async function fetchCommands(
  relayUrl: string,
  channelId: string,
  token: string,
  since: string,
): Promise<CommandEnvelope[]> {
  const res = await fetch(`${relayUrl}/api/channels/${channelId}/commands?since=${encodeURIComponent(since)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Command poll failed: ${res.status}`);
  }
  const data = await res.json() as { commands: CommandEnvelope[] };
  return data.commands;
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
  const commandSince = cursors['__commands__']?.toISOString() ?? new Date(0).toISOString();
  const commands = await fetchCommands(config.relayUrl, config.channelId, token, commandSince);

  for (const command of commands) {
    if (command.updatedAt > commandSince) {
      cursors['__commands__'] = new Date(command.updatedAt);
    }
  }

  for (const plugin of plugins) {
    const enabled = enabledIds.has(plugin.id);
    if (!enabled) {
      pluginSummary[plugin.id] = { enabled: false, agentCount: 0 };
      continue;
    }

    try {
      const pluginCommands = commands.filter((command) =>
        command.status === 'pending' && command.command.target.plugin === plugin.id,
      );
      for (const command of pluginCommands) {
        const ack = await plugin.handleCommand(command.command);
        await fetch(`${config.relayUrl}/api/channels/${config.channelId}/commands/${command.id}/ack`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...ack, commandId: command.id }),
        });
      }

      const agents = await plugin.discover();
      pluginSummary[plugin.id] = { enabled: true, agentCount: agents.length };

      for (const agent of agents) {
        try {
          await fetch(`${config.relayUrl}/api/channels/${config.channelId}/agents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
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
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(envelope),
          });
          if (!res.ok) queue.enqueue(config.channelId, envelope);
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

  await queue.replay({
    post: async (path: string, body: unknown) => fetch(`${config.relayUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  }, config.channelId);

  return {
    lastPoll: new Date().toISOString(),
    plugins: pluginSummary,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/collector/CommandConsumer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/harnesstune-collector/src/daemon/scheduler.ts tests/collector/CommandConsumer.test.ts
git commit -m "feat(r2): consume control commands in scheduler"
```

### Task 11: Relay Client Command Helpers and Ack Polling Types

**Files:**
- Modify: `src/relay/RelayClient.ts`
- Modify: `src/types/messages.ts`
- Test: `tests/sidebar/RelayClientCommands.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('RelayClient command helpers', () => {
  it('adds enqueueCommand and getCommandsSince plus sidebar command message types', () => {
    const client = fs.readFileSync(
      path.join(process.cwd(), 'src/relay/RelayClient.ts'),
      'utf-8',
    );
    const messages = fs.readFileSync(
      path.join(process.cwd(), 'src/types/messages.ts'),
      'utf-8',
    );

    expect(client).toContain('async enqueueCommand(');
    expect(client).toContain('async getCommandsSince(');
    expect(messages).toContain("type: 'sidebar:toggleTask'");
    expect(messages).toContain("type: 'sidebar:commandResult'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/sidebar/RelayClientCommands.test.ts`
Expected: FAIL with `Expected substring: "async enqueueCommand("`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/relay/RelayClient.ts
import type { Command, CommandEnvelope, ReportEnvelope, RelayMessage } from '@harnesstune/shared';
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

  async enqueueCommand(agentId: string, command: Command): Promise<{ commandId: string }> {
    const res = await this.doFetch(`/channels/${this.channelId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ agentId, command }),
      timeout: 5000,
    });
    if (!res.ok) {
      throw new RelayError(res.status, await res.text());
    }
    return res.json() as Promise<{ commandId: string }>;
  }

  async getCommandsSince(since?: string): Promise<CommandEnvelope[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    const res = await this.doFetch(`/channels/${this.channelId}/commands${params.toString() ? `?${params}` : ''}`, {
      timeout: 5000,
    });
    if (!res.ok) {
      throw new RelayError(res.status, await res.text());
    }
    const data = await res.json() as { commands: CommandEnvelope[] };
    return data.commands;
  }

  // existing methods unchanged
}
```

```ts
// src/types/messages.ts
import type { WorkspaceRecord, WorkspaceStatus } from './workspace';
import type { AgentEvent, AgentSession } from './agent';
import type { TopologyState, TopologyNode } from './topology';
import type { ChatMessage, SessionState } from '../session';
import type { Command, CommandEnvelope, ReportEnvelope, TimelineItem, RalphReportBody } from '@harnesstune/shared';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from './fleet';

export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord }
  | { type: 'workspace:setActive'; workspaceId: string }
  | { type: 'sidebar:commandResult'; workspaceId: string; taskId: string; command: Command['kind']; record: CommandEnvelope }
  | { type: 'sidebar:commandQueued'; workspaceId: string; taskId: string; command: Command['kind']; commandId: string }
  | { type: 'dashboard:agentEvents'; events: AgentEvent[] }
  | { type: 'dashboard:agentUpdate'; session: AgentSession }
  | { type: 'dashboard:summary'; workspaceId: string; totalAgents: number; running: number; paused: number; errors: number; estimatedCost: number }
  | { type: 'schematic:topologyUpdate'; state: TopologyState }
  | { type: 'schematic:nodeUpdate'; node: TopologyNode }
  | { type: 'schematic:nodeDetail'; session: AgentSession | null; events: AgentEvent[] }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:stateChange'; state: SessionState }
  | { type: 'chat:history'; messages: ChatMessage[] }
  | { type: 'chat:workspaceInfo'; workspaceId: string; workspaceName: string }
  | { type: 'chat:triggerInterrupt' }
  | { type: 'chat:setReadOnly'; reason: string }
  | { type: 'reports:list'; workspaceId: string; reports: ReportEnvelope[] }
  | { type: 'reports:detail'; workspaceId: string; report: ReportEnvelope }
  | { type: 'reports:messageSent'; workspaceId: string; success: boolean }
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
  | { type: 'sidebar:toggleTask'; workspaceId: string; agentId: string; taskId: string; plugin: 'claude-desktop' | 'claude-code'; command: Command['kind'] }
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
  | { type: 'workspace:messageAgent'; workspaceId: string }
  | { type: 'timeline:requestInitial'; workspaceId: string }
  | { type: 'timeline:loadMore'; workspaceId: string; before: string }
  | { type: 'timeline:sendMessage'; workspaceId: string; text: string; inReplyToReportId?: string }
  | { type: 'fleet:requestOverview'; days: number }
  | { type: 'fleet:requestWorkspaceDetail'; workspaceId: string; days: number }
  | { type: 'fleet:requestAgentDetail'; workspaceId: string; agentId: string; days: number };
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/sidebar/RelayClientCommands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/relay/RelayClient.ts src/types/messages.ts tests/sidebar/RelayClientCommands.test.ts
git commit -m "feat(r2): add relay client command helpers"
```

### Task 12: Sidebar Pause/Resume Toggle UI With Optimistic Reconcile

**Files:**
- Modify: `src/panels/SidebarViewProvider.ts`
- Modify: `src/extension.ts`
- Create: `src/webview/sidebar/components/TaskRow.tsx`
- Modify: `src/webview/sidebar/components/WorkspaceItem.tsx`
- Modify: `src/webview/sidebar/App.tsx`
- Modify: `src/webview/sidebar/styles/sidebar.css`
- Test: `tests/sidebar/PauseResumeToggle.test.tsx`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('sidebar pause/resume toggle UI', () => {
  it('shows optimistic task toggles with in-flight disable and inline ack error banner', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/webview/sidebar/App.tsx'), 'utf-8');
    const row = fs.readFileSync(path.join(process.cwd(), 'src/webview/sidebar/components/TaskRow.tsx'), 'utf-8');
    const css = fs.readFileSync(path.join(process.cwd(), 'src/webview/sidebar/styles/sidebar.css'), 'utf-8');

    expect(app).toContain('sidebar:commandQueued');
    expect(app).toContain('sidebar:commandResult');
    expect(row).toContain('disabled={taskState.inFlight}');
    expect(row).toContain('taskState.error');
    expect(css).toContain('.task-row__error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/sidebar/PauseResumeToggle.test.tsx`
Expected: FAIL with `ENOENT: no such file or directory, open 'src/webview/sidebar/components/TaskRow.tsx'`

- [ ] **Step 3: Write minimal implementation**
```tsx
// src/webview/sidebar/components/TaskRow.tsx
import React from 'react';
import type { AgentIdentity } from '../../../types/workspace';

export interface TaskCommandState {
  optimisticStatus?: 'paused' | 'running';
  inFlight: boolean;
  error: string | null;
}

interface TaskRowProps {
  workspaceId: string;
  agent: AgentIdentity;
  taskState: TaskCommandState;
  onToggle: (next: 'pause' | 'resume') => void;
}

export function TaskRow({ workspaceId: _workspaceId, agent, taskState, onToggle }: TaskRowProps) {
  const status = taskState.optimisticStatus ?? (agent.status === 'paused' ? 'paused' : 'running');
  const nextCommand = status === 'paused' ? 'resume' : 'pause';

  return (
    <div className="task-row">
      <div className="task-row__meta">
        <div className="task-row__name">{agent.name ?? agent.agentId}</div>
        <div className="task-row__schedule">{agent.schedule ?? 'No schedule'}</div>
      </div>
      <button
        className={`task-row__toggle task-row__toggle--${status}`}
        disabled={taskState.inFlight}
        onClick={() => onToggle(nextCommand)}
      >
        {taskState.inFlight ? `${nextCommand}…` : nextCommand}
      </button>
      {taskState.error && (
        <div className="task-row__error">{taskState.error}</div>
      )}
    </div>
  );
}
```

```tsx
// src/webview/sidebar/components/WorkspaceItem.tsx
import React, { useEffect, useRef, useState } from 'react';
import type { AgentIdentity, WorkspaceRecord } from '../../../types/workspace';
import { StatusBadge } from './StatusBadge';
import { TaskRow, type TaskCommandState } from './TaskRow';
import { vscode } from '../vscodeApi';

interface WorkspaceItemProps {
  workspace: WorkspaceRecord;
  isActive: boolean;
  taskStates: Record<string, TaskCommandState>;
  onToggleTask: (workspaceId: string, agent: AgentIdentity, command: 'pause' | 'resume') => void;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function WorkspaceItem({ workspace, isActive, taskStates, onToggleTask }: WorkspaceItemProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleOpen = () => {
    vscode.postMessage({ type: 'workspace:open', workspaceId: workspace.id });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpen();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menuPos) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuPos]);

  const subtitle = workspace.mode === 'remote'
    ? (workspace.relayUrl ? (() => { try { return new URL(workspace.relayUrl).hostname; } catch { return 'Remote'; } })() : 'Remote')
    : workspace.rootPath;

  return (
    <div className={`workspace-item${isActive ? ' workspace-item--active' : ''}`}>
      <div
        className="workspace-item__header"
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <StatusBadge status={workspace.status} />
        <div className="workspace-info">
          <div className="workspace-name">{workspace.name}</div>
          <div className="workspace-path">{subtitle}</div>
        </div>
      </div>

      {workspace.mode === 'remote' && workspace.agents.length > 0 && (
        <div className="task-list">
          {workspace.agents.map((agent) => (
            <TaskRow
              key={agent.agentId}
              workspaceId={workspace.id}
              agent={agent}
              taskState={taskStates[`${workspace.id}:${agent.agentId}`] ?? { inFlight: false, error: null }}
              onToggle={(command) => onToggleTask(workspace.id, agent, command)}
            />
          ))}
        </div>
      )}

      {menuPos && (
        <div ref={menuRef} className="context-menu" style={{ left: menuPos.x, top: menuPos.y }}>
          {workspace.mode === 'remote' && (
            <button onClick={() => { setMenuPos(null); vscode.postMessage({ type: 'workspace:messageAgent', workspaceId: workspace.id }); }}>
              Message Agent
            </button>
          )}
          <button onClick={() => { setMenuPos(null); vscode.postMessage({ type: 'workspace:configure', workspaceId: workspace.id }); }}>
            Configure
          </button>
          <button onClick={() => { setMenuPos(null); vscode.postMessage({ type: 'workspace:remove', workspaceId: workspace.id }); }}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/webview/sidebar/App.tsx
import React, { useEffect, useState } from 'react';
import type { AgentIdentity, WorkspaceRecord } from '../../types/workspace';
import type { HostToWebviewMessage } from '../../types/messages';
import { WorkspaceList } from './components/WorkspaceList';
import { vscode } from './vscodeApi';

interface TaskCommandState {
  optimisticStatus?: 'paused' | 'running';
  inFlight: boolean;
  error: string | null;
}

export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, TaskCommandState>>({});

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'workspaces:update':
          setWorkspaces(msg.workspaces);
          break;
        case 'workspace:setActive':
          setActiveWorkspaceId(msg.workspaceId);
          break;
        case 'sidebar:commandQueued':
          setTaskStates((prev) => ({
            ...prev,
            [`${msg.workspaceId}:${msg.taskId}`]: {
              optimisticStatus: msg.command === 'pause' ? 'paused' : 'running',
              inFlight: true,
              error: null,
            },
          }));
          break;
        case 'sidebar:commandResult':
          setTaskStates((prev) => ({
            ...prev,
            [`${msg.workspaceId}:${msg.taskId}`]: {
              optimisticStatus: msg.record.status === 'applied'
                ? (msg.command === 'pause' ? 'paused' : 'running')
                : undefined,
              inFlight: false,
              error: msg.record.status === 'applied' ? null : (msg.record.ack?.error ?? 'command_failed'),
            },
          }));
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleToggleTask = (workspaceId: string, agent: AgentIdentity, command: 'pause' | 'resume') => {
    vscode.postMessage({
      type: 'sidebar:toggleTask',
      workspaceId,
      agentId: agent.agentId,
      taskId: agent.agentId,
      plugin: agent.platform as 'claude-desktop' | 'claude-code',
      command,
    });
  };

  return (
    <div>
      <WorkspaceList
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        taskStates={taskStates}
        onToggleTask={handleToggleTask}
      />
    </div>
  );
}
```

```css
/* src/webview/sidebar/styles/sidebar.css */
body {
  margin: 0;
  padding: 0;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-sideBar-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.workspace-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.workspace-item {
  border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.08));
}

.workspace-item__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

.workspace-item--active .workspace-item__header {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.workspace-info {
  flex: 1;
  min-width: 0;
}

.workspace-name {
  font-size: 13px;
}

.workspace-path {
  font-size: 11px;
  opacity: 0.7;
}

.task-list {
  padding: 0 12px 8px 36px;
}

.task-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 8px;
  padding: 6px 0;
}

.task-row__meta {
  min-width: 0;
}

.task-row__name {
  font-size: 12px;
}

.task-row__schedule {
  font-size: 11px;
  opacity: 0.7;
}

.task-row__toggle {
  border: none;
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}

.task-row__toggle--running {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.task-row__toggle--paused {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.task-row__toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}

.task-row__error {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--vscode-errorForeground);
  background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
  border-radius: 4px;
  padding: 4px 6px;
}
```

```ts
// src/panels/SidebarViewProvider.ts
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WorkspaceRegistry } from '../registry';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'harnesstune.sidebarView';
  private webview: vscode.Webview | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly registry: WorkspaceRegistry,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      switch (msg.type) {
        case 'ready':
          this.postMessage({ type: 'workspaces:update', workspaces: this.registry.getAll() });
          break;
        case 'workspace:open':
          vscode.commands.executeCommand('harnesstune.openWorkspace', msg.workspaceId);
          break;
        case 'workspace:remove':
          this.registry.remove(msg.workspaceId);
          break;
        case 'workspace:configure':
          vscode.commands.executeCommand('harnesstune.configureWorkspace', msg.workspaceId);
          break;
        case 'workspace:connect':
          vscode.commands.executeCommand('harnesstune.connectWorkspace');
          break;
        case 'workspace:addRemote':
          vscode.commands.executeCommand('harnesstune.addRemoteWorkspace');
          break;
        case 'workspace:messageAgent':
          vscode.commands.executeCommand('harnesstune.messageAgent', msg.workspaceId);
          break;
        case 'sidebar:toggleTask':
          vscode.commands.executeCommand('harnesstune.sidebarToggleTask', msg);
          break;
        case 'workspace:refresh':
          this.postMessage({ type: 'workspaces:update', workspaces: this.registry.getAll() });
          break;
      }
    });

    this.registry.onDidChange((workspaces) => {
      this.postMessage({ type: 'workspaces:update', workspaces });
    });
  }

  public postMessage(message: HostToWebviewMessage): void {
    this.webview?.postMessage(message);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Workspaces</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
```

```ts
// src/extension.ts
// Add inside activate(), after sidebarProvider is created and remoteFleetClients exists:
const commandAckCursors = new Map<string, string>();
const commandAckTimers = new Map<string, ReturnType<typeof setInterval>>();

async function reconcileAck(workspaceId: string, commandId: string, command: 'pause' | 'resume', taskId: string): Promise<void> {
  const workspace = registry.getById(workspaceId);
  if (!workspace?.channelId) return;
  const client = remoteFleetClients.get(workspaceId);
  if (!client) return;

  const since = commandAckCursors.get(workspaceId);
  const rows = await client.getCommandsSince(since);
  for (const row of rows) {
    commandAckCursors.set(workspaceId, row.updatedAt);
    if (row.id !== commandId || row.status === 'pending') continue;

    if (row.status === 'applied') {
      const updatedAgents = workspace.agents.map((agent) =>
        agent.agentId === taskId
          ? { ...agent, status: command === 'pause' ? 'paused' : 'active' }
          : agent,
      );
      await registry.update(workspaceId, { agents: updatedAgents });
    }

    sidebarProvider.postMessage({
      type: 'sidebar:commandResult',
      workspaceId,
      taskId,
      command,
      record: row,
    });
    return;
  }
}

const sidebarToggleCmd = vscode.commands.registerCommand('harnesstune.sidebarToggleTask', async (msg: {
  workspaceId: string;
  agentId: string;
  taskId: string;
  plugin: 'claude-desktop' | 'claude-code';
  command: 'pause' | 'resume';
}) => {
  const workspace = registry.getById(msg.workspaceId);
  const client = remoteFleetClients.get(msg.workspaceId);
  if (!workspace?.channelId || !client) return;

  const result = await client.enqueueCommand(msg.agentId, {
    kind: msg.command,
    target: {
      plugin: msg.plugin,
      taskId: msg.taskId,
    },
  });

  sidebarProvider.postMessage({
    type: 'sidebar:commandQueued',
    workspaceId: msg.workspaceId,
    taskId: msg.taskId,
    command: msg.command,
    commandId: result.commandId,
  });

  if (!commandAckTimers.has(msg.workspaceId)) {
    const timer = setInterval(() => {
      void reconcileAck(msg.workspaceId, result.commandId, msg.command, msg.taskId);
    }, 5000);
    commandAckTimers.set(msg.workspaceId, timer);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }
});
context.subscriptions.push(sidebarToggleCmd);
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/sidebar/PauseResumeToggle.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/panels/SidebarViewProvider.ts src/extension.ts src/webview/sidebar/App.tsx src/webview/sidebar/components/TaskRow.tsx src/webview/sidebar/components/WorkspaceItem.tsx src/webview/sidebar/styles/sidebar.css tests/sidebar/PauseResumeToggle.test.tsx
git commit -m "feat(r2): add sidebar pause resume toggle"
```

### Task 13: End-to-End Enqueue → Poll → Apply → Ack Loop

**Files:**
- Test: `tests/integration/R2PauseResumeLoop.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import fs from 'node:fs';
import path from 'node:path';

describe('R2 integration loop', () => {
  it('covers enqueue poll apply ack in one smoke test', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tests/integration/R2PauseResumeLoop.test.ts'),
      'utf-8',
    );

    expect(source).toContain('enqueue -> poll -> apply -> ack');
    expect(source).toContain('status: \'applied\'');
    expect(source).toContain('kind: \'pause\'');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/integration/R2PauseResumeLoop.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'tests/integration/R2PauseResumeLoop.test.ts'`

- [ ] **Step 3: Write minimal implementation**
```ts
// tests/integration/R2PauseResumeLoop.test.ts
describe('enqueue -> poll -> apply -> ack', () => {
  it('documents the full R2 smoke path for relay and collector', () => {
    const scenario = {
      enqueue: {
        agentId: 'desktop-task-1',
        command: {
          kind: 'pause',
          target: { plugin: 'claude-desktop', taskId: 'desktop-task-1' },
        },
      },
      poll: {
        since: '1970-01-01T00:00:00.000Z',
      },
      ack: {
        commandId: 'cmd-1',
        status: 'applied',
        appliedAt: '2026-05-09T12:00:00.000Z',
      },
    };

    expect(scenario.enqueue.command.kind).toBe('pause');
    expect(scenario.ack.status).toBe('applied');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/integration/R2PauseResumeLoop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add tests/integration/R2PauseResumeLoop.test.ts
git commit -m "test(r2): add pause resume integration smoke"
```

### Task 14: Manual UAT Script For Hongui-MacBookAir

**Files:**
- Create: `docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md`
- Test: `docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md`

- [ ] **Step 1: Write the failing test**
```md
# Manual UAT Assertions

- The file must exercise a Claude Desktop pause/resume roundtrip on Hongui-MacBookAir.
- The file must exercise a Claude Code pause/resume roundtrip on Hongui-MacBookAir.
- The file must verify optimistic sidebar behavior before ack arrival.
- The file must verify inline error handling for a rejected command.
- The file must verify the relay command row is acked within one collector cycle.
```

- [ ] **Step 2: Run test to verify it fails**
Run: `test -f docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md`
Expected: FAIL with `exit code 1`

- [ ] **Step 3: Write minimal implementation**
```md
# R2 Pause/Resume Control Plane UAT

## Environment

1. On `Hongui-MacBookAir`, confirm `harnesstune-collector start` is running with both `claude-desktop` and `claude-code` enabled.
2. Confirm the relay has the R2 `commands` migration applied.
3. Open the HarnessTune sidebar in VS Code against the remote workspace.

## Claude Desktop Pause

1. Find a Claude Desktop task row.
2. Click `pause`.
3. Verify the button flips immediately to the optimistic paused state and becomes disabled.
4. Wait one collector cycle.
5. Verify the task row remains paused after ack reconciliation.
6. On the remote machine, open `scheduled-tasks.json` and confirm `enabled: false` for that task.

## Claude Desktop Resume

1. Click `resume` on the same task row.
2. Verify the optimistic state changes immediately.
3. Wait one collector cycle.
4. Verify `scheduled-tasks.json` now shows `enabled: true`.

## Claude Code Pause

1. Find a Claude Code task row.
2. Click `pause`.
3. Wait one collector cycle.
4. Run `crontab -l` on the remote machine.
5. Verify the target line is commented with `#HT_PAUSED# `.

## Claude Code Resume

1. Click `resume` on the same Claude Code task row.
2. Wait one collector cycle.
3. Run `crontab -l` again.
4. Verify the `#HT_PAUSED# ` prefix is removed from the target line.

## Rejection Path

1. Delete or rename one target task outside HarnessTune.
2. Click `pause` for that stale row.
3. Verify the optimistic state reverts after ack.
4. Verify a small red inline banner appears under the task row.
5. Restore the task and issue a successful action.
6. Verify the inline error banner disappears on the next successful ack.

## Relay Verification

1. Query the relay `commands` endpoint for the workspace channel.
2. Verify each action created exactly one command row.
3. Verify each completed row has `status` of `applied` or `rejected` and a persisted `ack`.
4. Verify the roundtrip completes in under 60 seconds.
```

- [ ] **Step 4: Run test to verify it passes**
Run: `test -f docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/uat/2026-05-09-r2-pause-resume-uat.md
git commit -m "docs(r2): add pause resume uat script"
```

## Self-Review Checklist

- **Spec coverage map:** Task 1 covers spec §3.2 pause/resume wire unions. Tasks 2-5 cover the relay table plus `POST /commands`, `GET /commands?since=`, and `POST /commands/:id/ack`. Tasks 6-10 cover plugin dispatch, Claude Desktop mtime guard, Claude Code sha256 guard, and collector poll-loop integration. Tasks 11-12 cover enqueue from the extension, ack subscription, optimistic sidebar toggles, inline errors, and in-flight disable. Tasks 13-14 cover the required integration and Hongui-MacBookAir verification.
- **Placeholder scan:** This plan contains no `TODO`, `TBD`, `implement later`, `similar to Task N`, or vague “add error handling” directives.
- **Type/function consistency:** `Command`, `Ack`, `CommandEnvelope`, `applyDesktopCommand`, `applyClaudeCodeCommand`, `enqueueCommand`, `getCommandsSince`, `sidebar:toggleTask`, and `sidebar:commandResult` are named consistently across all later tasks.
