import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { agents } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

export const agentsRouter = new Hono<{ Variables: AuthVariables }>();

// POST /channels/:channelId/agents — register agent (explicit creation)
agentsRouter.post('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ agentId: string; name?: string; platform: string; schedule?: string }>();
  if (!body.agentId || !body.platform) return c.json({ error: 'agentId and platform are required' }, 400);

  const db = getDb();
  // Upsert: if agent already exists for this channel, return existing
  const existing = await db.select().from(agents)
    .where(and(eq(agents.channelId, channelId), eq(agents.agentId, body.agentId)))
    .limit(1);

  if (existing.length > 0) {
    // Update with any new fields provided
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.schedule !== undefined) updates.schedule = body.schedule;
    if (Object.keys(updates).length > 0) {
      await db.update(agents).set(updates)
        .where(and(eq(agents.channelId, channelId), eq(agents.agentId, body.agentId)));
      // Return updated record rather than the pre-update snapshot
      const updated = await db.select().from(agents)
        .where(and(eq(agents.channelId, channelId), eq(agents.agentId, body.agentId)))
        .limit(1);
      return c.json(updated[0], 200);
    }
    return c.json(existing[0], 200);
  }

  const id = randomUUID();
  await db.insert(agents).values({
    id, channelId, agentId: body.agentId,
    name: body.name ?? null, platform: body.platform,
    schedule: body.schedule ?? null,
  });

  const created = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return c.json(created[0], 201);
});

// GET /channels/:channelId/agents — list all agents for channel
agentsRouter.get('/', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');
  if (channelId !== authedChannelId) return c.json({ error: 'Forbidden' }, 403);

  const db = getDb();
  const rows = await db.select().from(agents).where(eq(agents.channelId, channelId));
  return c.json({ agents: rows });
});
