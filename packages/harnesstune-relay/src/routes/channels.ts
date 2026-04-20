import { Hono } from 'hono';
import { randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { channels, tokens } from '../db/schema.js';
import type { AuthVariables } from '../middleware/auth.js';

// Public routes (no auth)
export const publicChannelsRouter = new Hono();

// POST /channels — register new channel, return token ONCE
publicChannelsRouter.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name || typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 100) {
    return c.json({ error: 'name is required (1-100 chars)' }, 400);
  }

  const db = getDb();
  const channelId = randomUUID();
  const tokenId = randomUUID();
  const rawToken = randomUUID();  // The raw token shown once
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  await db.insert(channels).values({ id: channelId, name: body.name });
  await db.insert(tokens).values({
    id: tokenId,
    channelId,
    tokenHash,
    label: body.name,
  });

  return c.json({
    channelId,
    token: rawToken,  // Shown once — not stored anywhere after this response
    message: 'Save this token. It will not be shown again.',
  }, 201);
});

// Authenticated routes
export const channelsRouter = new Hono<{ Variables: AuthVariables }>();

// GET /channels/me — token introspection: return the channelId bound to this token
channelsRouter.get('/me', async (c) => {
  const channelId = c.get('channelId');
  return c.json({ channelId });
});

// GET /channels/:channelId — channel metadata
channelsRouter.get('/:channelId', async (c) => {
  const channelId = c.req.param('channelId');
  const authedChannelId = c.get('channelId');

  if (channelId !== authedChannelId) {
    return c.json({ error: 'Forbidden — token does not match channel' }, 403);
  }

  const db = getDb();
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  return c.json(rows[0]);
});
