import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock chokidar before importing adapter
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { OpenClawAdapter } from '../../src/adapters/OpenClawAdapter';
import type { OpenClawEvent } from '../../src/types/openclaw';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
}

describe('OpenClawAdapter', () => {
  let adapter: OpenClawAdapter;

  beforeEach(() => {
    adapter = new OpenClawAdapter();
  });

  afterEach(() => {
    adapter.dispose();
  });

  // ── normalizeEvent tests ──────────────────────────────────────────────

  describe('normalizeEvent', () => {
    const wsId = 'test-ws-1';

    test('maps session_start to SessionStart', () => {
      const raw: OpenClawEvent = {
        type: 'session_start',
        agent_id: 'agent-001',
        timestamp: '2025-01-01T00:00:00Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.eventType).toBe('SessionStart');
      expect(event.sessionId).toBe('agent-001');
      expect(event.workspaceId).toBe(wsId);
    });

    test('maps tool_use to PreToolUse', () => {
      const raw: OpenClawEvent = {
        type: 'tool_use',
        agent_id: 'agent-001',
        timestamp: '2025-01-01T00:00:01Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.eventType).toBe('PreToolUse');
    });

    test('maps tool_result to PostToolUse', () => {
      const raw: OpenClawEvent = {
        type: 'tool_result',
        agent_id: 'agent-001',
        timestamp: '2025-01-01T00:00:02Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.eventType).toBe('PostToolUse');
    });

    test('maps session_end to SessionEnd', () => {
      const raw: OpenClawEvent = {
        type: 'session_end',
        agent_id: 'agent-001',
        timestamp: '2025-01-01T00:00:03Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.eventType).toBe('SessionEnd');
    });

    test('defaults unknown type to SessionStart and logs warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const raw: OpenClawEvent = {
        type: 'unknown_event',
        agent_id: 'agent-001',
        timestamp: '2025-01-01T00:00:04Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.eventType).toBe('SessionStart');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown event type'),
        'unknown_event',
      );
      warnSpy.mockRestore();
    });

    test('generates fallback agent_id with openclaw- prefix when empty', () => {
      const raw: OpenClawEvent = {
        type: 'session_start',
        agent_id: '',
        timestamp: '2025-01-01T00:00:05Z',
      };
      const event = adapter.normalizeEvent(wsId, raw);
      expect(event.sessionId).toMatch(/^openclaw-/);
    });
  });

  // ── readIncremental tests ─────────────────────────────────────────────

  describe('readIncremental', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('reads only new bytes from offset', () => {
      const filePath = path.join(tmpDir, 'events.jsonl');
      const line1 = JSON.stringify({ type: 'session_start', agent_id: 'a1', timestamp: '2025-01-01T00:00:00Z' });
      fs.writeFileSync(filePath, line1 + '\n');

      const fired: unknown[] = [];
      adapter.onDidReceiveEvent((e) => fired.push(e));

      adapter.readIncremental('ws-1', filePath);
      expect(fired).toHaveLength(1);

      // Append more
      const line2 = JSON.stringify({ type: 'session_end', agent_id: 'a1', timestamp: '2025-01-01T00:00:01Z' });
      fs.appendFileSync(filePath, line2 + '\n');

      adapter.readIncremental('ws-1', filePath);
      expect(fired).toHaveLength(2);
    });

    test('skips lines that fail JSON.parse', () => {
      const filePath = path.join(tmpDir, 'events.jsonl');
      const validLine = JSON.stringify({ type: 'session_start', agent_id: 'a1', timestamp: '2025-01-01T00:00:00Z' });
      fs.writeFileSync(filePath, `not valid json\n${validLine}\n{broken\n`);

      const fired: unknown[] = [];
      adapter.onDidReceiveEvent((e) => fired.push(e));

      adapter.readIncremental('ws-1', filePath);
      expect(fired).toHaveLength(1);
    });
  });

  // ── connect idempotency ───────────────────────────────────────────────

  describe('connect', () => {
    test('is idempotent - second call does not create second watcher', async () => {
      const chokidar = require('chokidar');
      (chokidar.watch as jest.Mock).mockClear();

      await adapter.connect('ws-1', '/tmp/ws');
      await adapter.connect('ws-1', '/tmp/ws');

      expect(chokidar.watch).toHaveBeenCalledTimes(1);
    });
  });
});
