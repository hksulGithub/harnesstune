import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, gt, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { messages } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const messagesRouter = new Hono<{ Variables: AuthVariables }>();

// POST /channels/:channelId/messages — post message (extension -> agent or agent -> extension)
messagesRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{ direction: string; body: Record<string, unknown> }>();
  if (!body.direction || !['to_agent', 'from_agent'].includes(body.direction)) {
    return c.json({ error: 'direction must be "to_agent" or "from_agent"' }, 400);
  }
  if (!body.body) {
    return c.json({ error: 'body is required' }, 400);
  }

  const db = getDb();
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    channelId,
    direction: body.direction,
    body: JSON.stringify(body.body),
  });

  return c.json({ id, channelId, direction: body.direction, createdAt: new Date().toISOString() }, 201);
});

// GET /channels/:channelId/messages — poll messages with ?since= cursor
messagesRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);

  const db = getDb();
  const rows = await db.select().from(messages).where(
    since
      ? and(eq(messages.channelId, channelId), gt(messages.createdAt, new Date(since)))
      : eq(messages.channelId, channelId)
  ).orderBy(desc(messages.createdAt)).limit(limit);

  // Parse JSON body back to objects
  const parsed = rows.map(row => ({
    ...row,
    body: JSON.parse(row.body),
  }));

  return c.json({ messages: parsed, count: parsed.length });
});

// DELETE /channels/:channelId/messages/:messageId — acknowledge and remove (hard delete per D-02)
messagesRouter.delete('/:messageId', async (c) => {
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const db = getDb();
  await db.delete(messages).where(
    and(eq(messages.id, messageId), eq(messages.channelId, channelId))
  );

  return c.json({ deleted: true, id: messageId });
});
