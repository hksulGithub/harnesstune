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
