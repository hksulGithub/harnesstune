import { createMiddleware } from 'hono/factory';
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tokens } from '../db/schema.js';

export type AuthVariables = {
  tokenId: string;
  channelId: string;
};

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or malformed Authorization header' }, 401);
  }

  const rawToken = authHeader.slice(7);
  const providedHash = hashToken(rawToken);
  const db = getDb();

  const tokenRows = await db.select().from(tokens).where(eq(tokens.tokenHash, providedHash)).limit(1);
  if (tokenRows.length === 0) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Use timingSafeEqual for the final comparison to prevent timing attacks
  const storedHashBuf = Buffer.from(tokenRows[0].tokenHash, 'hex');
  const providedHashBuf = Buffer.from(providedHash, 'hex');
  if (!timingSafeEqual(storedHashBuf, providedHashBuf)) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('tokenId', tokenRows[0].id);
  c.set('channelId', tokenRows[0].channelId);
  await next();
});
