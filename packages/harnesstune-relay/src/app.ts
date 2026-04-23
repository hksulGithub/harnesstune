import { Hono } from 'hono';
import { sanitizeMiddleware } from './middleware/sanitize.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { versionMiddleware } from './middleware/version.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { publicChannelsRouter, channelsRouter } from './routes/channels.js';
import { reportsRouter } from './routes/reports.js';
import { messagesRouter } from './routes/messages.js';
import { agentsRouter } from './routes/agents.js';
import { runsUploadRouter, runsRouter } from './routes/runs.js';
import { summaryRouter } from './routes/summary.js';

export const RELAY_VERSION = '0.1.0';

// Public app — no auth required
const app = new Hono();

// Global error handler — surface errors instead of crashing
app.onError((err, c) => {
  console.error('Hono error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Health check — public, before all middleware (both root and /api prefix)
app.get('/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));
app.get('/api/health', (c) => c.json({ status: 'ok', version: RELAY_VERSION }));

// Public channel registration (no auth required — agent has no token yet)
app.route('/api/channels', publicChannelsRouter);

// Authenticated routes
const api = new Hono<{ Variables: AuthVariables }>();

// Middleware chain order (per CONTEXT.md D-01):
// 1. Health check (above, public)
// 2. Header sanitization
// 3. Token auth
// 4. Version validation
// 5. Rate limiting (after auth, needs tokenId)
// 6. Route handlers (Plan 02)
api.use('*', sanitizeMiddleware);
api.use('*', authMiddleware);
api.use('*', versionMiddleware);
api.use('*', rateLimitMiddleware);

// Route handlers
api.route('/channels', channelsRouter);
api.route('/channels/:channelId/reports', reportsRouter);
api.route('/channels/:channelId/messages', messagesRouter);
api.route('/channels/:channelId/agents', agentsRouter);
api.route('/channels/:channelId/runs', runsUploadRouter);
api.route('/channels/:channelId/agents/:agentId/runs', runsRouter);
api.route('/channels/:channelId/summary', summaryRouter);

app.route('/api', api);

export { app };
export type AppType = typeof app;
