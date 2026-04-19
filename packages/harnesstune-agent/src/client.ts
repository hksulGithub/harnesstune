import { AGENT_VERSION } from './index.js';

export interface RelayClient {
  post(path: string, body: unknown): Promise<Response>;
  get(path: string, params?: Record<string, string>): Promise<Response>;
  delete(path: string): Promise<Response>;
}

export function createClient(relayUrl: string, token: string): RelayClient {
  const base = relayUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Agent-Version': AGENT_VERSION,
  };

  return {
    async post(path, body) {
      return fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    async get(path, params) {
      const url = new URL(`${base}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      }
      return fetch(url.toString(), { method: 'GET', headers });
    },
    async delete(path) {
      return fetch(`${base}${path}`, { method: 'DELETE', headers });
    },
  };
}
