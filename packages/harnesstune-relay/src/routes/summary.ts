import { Hono } from 'hono';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { agentRuns } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const summaryRouter = new Hono<{ Variables: AuthVariables }>();

// GET /channels/:channelId/summary?days=N
summaryRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = getDb();
  const rows = await db.select({
    agentId: agentRuns.agentId,
    totalRuns: sql<number>`COUNT(*)`,
    successCount: sql<number>`SUM(CASE WHEN ${agentRuns.status} = 'success' THEN 1 ELSE 0 END)`,
    totalCostCents: sql<number>`COALESCE(SUM(${agentRuns.costCents}), 0)`,
    lastRunAt: sql<string>`MAX(${agentRuns.finishedAt})`,
  }).from(agentRuns)
    .where(and(eq(agentRuns.channelId, channelId), gte(agentRuns.startedAt, since)))
    .groupBy(agentRuns.agentId);

  const agentSummaries = rows.map(row => ({
    agentId: row.agentId,
    totalRuns: row.totalRuns,
    successCount: row.successCount,
    failureCount: row.totalRuns - row.successCount,
    successRate: row.totalRuns > 0 ? row.successCount / row.totalRuns : 0,
    totalCostCents: row.totalCostCents,
    lastRunAt: row.lastRunAt,
  }));

  return c.json({ channelId, days, agents: agentSummaries });
});
