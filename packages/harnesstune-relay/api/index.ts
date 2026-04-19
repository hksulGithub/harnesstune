import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../src/app.js';

// Vercel extends IncomingMessage with pre-parsed body
interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

export default async function handler(req: VercelRequest, res: ServerResponse) {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `${protocol}://${host}`);

    // Vercel pre-parses body as object — stringify for Request constructor
    let bodyInit: BodyInit | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      bodyInit = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      ...(bodyInit !== undefined ? { body: bodyInit, duplex: 'half' as const } : {}),
    });

    const response = await app.fetch(request);

    const resHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { resHeaders[k] = v; });
    res.writeHead(response.status, resHeaders);
    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err: any) {
    console.error('Handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal Server Error', message: err?.message }));
  }
}
