import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HookServer } from '../../src/server/HookServer';

function makeStorageUri(): { fsPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookserver-test-'));
  return { fsPath: dir };
}

function httpPost(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('HookServer', () => {
  let server: HookServer;
  let storageUri: { fsPath: string };

  beforeEach(() => {
    storageUri = makeStorageUri();
    server = new HookServer(storageUri);
  });

  afterEach(() => {
    server.dispose();
  });

  it('listens on dynamic port on 127.0.0.1', async () => {
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
    // hookUrl should use 127.0.0.1
    expect(server.hookUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/hook\?token=/);
  });

  it('rejects requests without valid token', async () => {
    await server.start();
    const badUrl = server.hookUrl.replace(/token=\w+/, 'token=badtoken');
    const result = await httpPost(badUrl, JSON.stringify({ event: 'SessionStart' }));
    expect(result.status).toBe(401);
  });

  it('returns 200 with continue:true for valid request', async () => {
    await server.start();
    const result = await httpPost(server.hookUrl, JSON.stringify({ event: 'SessionStart', session_id: 'sess_1' }));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ continue: true });
  });

  it('emits hookEvent with parsed payload', async () => {
    await server.start();
    const payload = { event: 'SessionStart', session_id: 'sess_emit', timestamp: '2026-04-16T10:00:00Z' };
    const received = await new Promise<unknown>((resolve) => {
      server.once('hookEvent', resolve);
      httpPost(server.hookUrl, JSON.stringify(payload));
    });
    expect(received).toMatchObject({ event: 'SessionStart', session_id: 'sess_emit' });
  });

  it('returns deny payload for PreToolUse when paused', async () => {
    await server.start();
    server.setPauseChecker(() => true);
    const payload = { event: 'PreToolUse', session_id: 'sess_paused', tool_name: 'Bash', tool_input: { command: 'ls' } };
    const result = await httpPost(server.hookUrl, JSON.stringify(payload));
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Agent paused by HarnessTune operator',
      },
    });
  });

  it('returns continue:true for PreToolUse when not paused', async () => {
    await server.start();
    server.setPauseChecker(() => false);
    const payload = { event: 'PreToolUse', session_id: 'sess_running', tool_name: 'Bash', tool_input: {} };
    const result = await httpPost(server.hookUrl, JSON.stringify(payload));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ continue: true });
  });
});
