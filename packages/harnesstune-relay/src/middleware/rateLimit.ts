import { createMiddleware } from 'hono/factory';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { rateLimits } from '../db/schema.js';
import type { AuthVariables } from './auth.js';

const MAX_REQUESTS_PER_MINUTE = 60;

export const rateLimitMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const tokenId = c.get('tokenId');
  if (!tokenId) {
    // If auth didn't set tokenId, skip rate limiting (shouldn't happen in normal flow)
    await next();
    return;
  }

  const db = getDb();
  const windowStart = Math.floor(Date.now() / 60000); // unix epoch minute

  // Upsert: increment count or insert with count=1
  await db.insert(rateLimits).values({
    tokenId,
    windowStart,
    count: 1,
  }).onConflictDoUpdate({
    target: [rateLimits.tokenId, rateLimits.windowStart],
    set: { count: sql`${rateLimits.count} + 1` },
  });

  // Read current count
  const rows = await db.select().from(rateLimits).where(
    and(eq(rateLimits.tokenId, tokenId), eq(rateLimits.windowStart, windowStart))
  ).limit(1);

  const count = rows[0]?.count ?? 0;
  if (count > MAX_REQUESTS_PER_MINUTE) {
    const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too Many Requests', retryAfter }, 429);
  }

  await next();
});
