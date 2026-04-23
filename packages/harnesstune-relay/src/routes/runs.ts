import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, gt, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { agentRuns, agents } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const runsRouter = new Hono<{ Variables: AuthVariables }>();

// POST /channels/:channelId/runs — upload run report
runsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    agentId: string; startedAt: string; finishedAt: string;
    status: string; durationMs: number;
    logExcerpt?: string; errorSummary?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    costCents?: number;
  }>();
  if (!body.agentId || !body.startedAt || !body.finishedAt || !body.status) {
    return c.json({ error: 'agentId, startedAt, finishedAt, and status are required' }, 400);
  }

  const db = getDb();
  const id = randomUUID();
  await db.insert(agentRuns).values({
    id, channelId, agentId: body.agentId,
    startedAt: new Date(body.startedAt),
    finishedAt: new Date(body.finishedAt),
    status: body.status,
    durationMs: body.durationMs ?? 0,
    logExcerpt: body.logExcerpt ?? null,
    errorSummary: body.errorSummary ?? null,
    tokenUsage: body.tokenUsage ? JSON.stringify(body.tokenUsage) : null,
    costCents: body.costCents ?? null,
  });

  // Upsert agent stub if agentId not in agents table (D-02 upsert-on-run path)
  const existingAgent = await db.select().from(agents)
    .where(and(eq(agents.channelId, channelId), eq(agents.agentId, body.agentId)))
    .limit(1);
  if (existingAgent.length === 0) {
    await db.insert(agents).values({
      id: randomUUID(), channelId, agentId: body.agentId,
      platform: 'unknown', name: null, schedule: null,
    });
  }

  // Update agent lastRunAt
  await db.update(agents).set({ lastRunAt: new Date(body.finishedAt) })
    .where(and(eq(agents.channelId, channelId), eq(agents.agentId, body.agentId)));

  return c.json({ id, channelId, agentId: body.agentId, status: body.status }, 201);
});

// GET /channels/:channelId/agents/:agentId/runs — paginated run history
// Note: mounted at /channels/:channelId/agents/:agentId/runs in app.ts
runsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const agentId = c.req.param('agentId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  const db = getDb();
  const conditions = [eq(agentRuns.channelId, channelId), eq(agentRuns.agentId, agentId)];
  if (since) conditions.push(gt(agentRuns.startedAt, new Date(since)));

  const rows = await db.select().from(agentRuns)
    .where(and(...conditions))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit);

  return c.json({ runs: rows, count: rows.length });
});
