import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, gt, desc, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { reports } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

const MAX_REPORT_SIZE = 2 * 1024 * 1024; // 2MB

export const reportsRouter = new Hono<{ Variables: AuthVariables }>();

// POST /channels/:channelId/reports — upload report
reportsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Check content-length for 2MB limit
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

  return c.json({ id, channelId, type: body.type, createdAt: new Date().toISOString() }, 201);
});

// GET /channels/:channelId/reports — paginated metadata list (?since= cursor, ?agentId= filter)
reportsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const since = c.req.query('since');  // ISO 8601 timestamp cursor
  const agentId = c.req.query('agentId');  // optional agent filter
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  const db = getDb();

  // Build where conditions
  const conditions = [eq(reports.channelId, channelId)];
  if (since) conditions.push(gt(reports.createdAt, new Date(since)));
  if (agentId) conditions.push(eq(reports.agentId, agentId));

  const rows = await db.select({
    id: reports.id,
    channelId: reports.channelId,
    type: reports.type,
    agentId: reports.agentId,
    createdAt: reports.createdAt,
    // body intentionally excluded — metadata only (RLAY-10)
  }).from(reports).where(
    and(...conditions)
  ).orderBy(desc(reports.createdAt)).limit(limit);

  return c.json({ reports: rows, count: rows.length });
});

// GET /channels/:channelId/reports/:reportId — full body
reportsRouter.get('/:reportId', async (c) => {
  const channelId = c.req.param('channelId');
  const reportId = c.req.param('reportId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const db = getDb();
  const rows = await db.select().from(reports).where(
    and(eq(reports.id, reportId), eq(reports.channelId, channelId))
  ).limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Report not found' }, 404);
  }

  // Parse the stored JSON body back to object
  const report = rows[0];
  return c.json({
    ...report,
    body: JSON.parse(report.body),
  });
});
