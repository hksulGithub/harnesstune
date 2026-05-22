import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './dist/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env so TURSO_DATABASE_URL / TURSO_AUTH_TOKEN reach the libSQL client
try {
  const env = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn('[relay] no .env file found (TURSO_* must be set externally)');
}

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer(async (req, res) => {
  try {
    const protocol = 'http';
    const host = req.headers.host ?? `${HOST}:${PORT}`;
    const url = new URL(req.url ?? '/', `${protocol}://${host}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length > 0) body = Buffer.concat(chunks);
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      ...(body !== undefined ? { body, duplex: 'half' } : {}),
    });

    const response = await app.fetch(request);
    const resHeaders = {};
    response.headers.forEach((v, k) => { resHeaders[k] = v; });
    res.writeHead(response.status, resHeaders);
    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error('[relay] handler error:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', message: err?.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
  console.log(`[relay] LAN URL: http://192.168.0.111:${PORT}`);
});
