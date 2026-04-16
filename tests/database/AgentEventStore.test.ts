import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentEventStore } from '../../src/database/AgentEventStore';
import type { AgentEvent } from '../../src/types/agent';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-event-store-test-'));
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    agentId: 'agent-1',
    eventType: 'PreToolUse',
    timestamp: Date.now(),
    raw: { source: 'test' },
    ...overrides,
  };
}

describe('AgentEventStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('init and flush: persists events across reload', async () => {
    const store = new AgentEventStore({ fsPath: tmpDir });
    await store.init();

    const event = makeEvent({ id: 'test-persist-001' });
    store.insertEvent(event);
    store.flush();
    store.dispose();

    // Create new store at same path — should load persisted data
    const store2 = new AgentEventStore({ fsPath: tmpDir });
    await store2.init();

    const events = store2.getEventsBySession('sess-1');
    expect(events.length).toBe(1);
    expect(events[0].id).toBe('test-persist-001');
    store2.dispose();
  });

  it('token usage: aggregates correctly in session summary', async () => {
    const store = new AgentEventStore({ fsPath: tmpDir });
    await store.init();

    store.insertEvent(makeEvent({
      id: 'evt-tok-1',
      sessionId: 'sess-token',
      eventType: 'PostToolUse',
      tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
    }));
    store.insertEvent(makeEvent({
      id: 'evt-tok-2',
      sessionId: 'sess-token',
      eventType: 'PostToolUse',
      tokenUsage: { inputTokens: 200, outputTokens: 80 },
    }));

    const summary = store.getSessionSummary('sess-token');
    expect(summary.totalEvents).toBe(2);
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(130);
    expect(summary.totalCacheReadTokens).toBe(10);

    store.dispose();
  });

  it('getEventsBySession: returns events in timestamp DESC order', async () => {
    const store = new AgentEventStore({ fsPath: tmpDir });
    await store.init();

    const now = Date.now();
    store.insertEvent(makeEvent({ id: 'evt-a', sessionId: 'sess-order', timestamp: now - 200 }));
    store.insertEvent(makeEvent({ id: 'evt-b', sessionId: 'sess-order', timestamp: now - 100 }));
    store.insertEvent(makeEvent({ id: 'evt-c', sessionId: 'sess-order', timestamp: now }));

    const events = store.getEventsBySession('sess-order');
    expect(events.length).toBe(3);
    // DESC: newest first
    expect(events[0].id).toBe('evt-c');
    expect(events[1].id).toBe('evt-b');
    expect(events[2].id).toBe('evt-a');

    store.dispose();
  });

  it('getEventsByWorkspace: filters by workspaceId', async () => {
    const store = new AgentEventStore({ fsPath: tmpDir });
    await store.init();

    store.insertEvent(makeEvent({ id: 'evt-ws1-a', workspaceId: 'workspace-A', sessionId: 'sess-A' }));
    store.insertEvent(makeEvent({ id: 'evt-ws1-b', workspaceId: 'workspace-A', sessionId: 'sess-A2' }));
    store.insertEvent(makeEvent({ id: 'evt-ws2-a', workspaceId: 'workspace-B', sessionId: 'sess-B' }));

    const wsAEvents = store.getEventsByWorkspace('workspace-A');
    expect(wsAEvents.length).toBe(2);
    expect(wsAEvents.every(e => e.workspaceId === 'workspace-A')).toBe(true);

    const wsBEvents = store.getEventsByWorkspace('workspace-B');
    expect(wsBEvents.length).toBe(1);
    expect(wsBEvents[0].id).toBe('evt-ws2-a');

    store.dispose();
  });

  it('getWorkspaceSummary: aggregates across sessions for workspace', async () => {
    const store = new AgentEventStore({ fsPath: tmpDir });
    await store.init();

    store.insertEvent(makeEvent({
      id: 'evt-s1',
      workspaceId: 'ws-agg',
      sessionId: 'sess-agg-1',
      eventType: 'PostToolUse',
      toolName: 'Bash',
    }));
    store.insertEvent(makeEvent({
      id: 'evt-s2',
      workspaceId: 'ws-agg',
      sessionId: 'sess-agg-2',
      eventType: 'PostToolUseFailure',
      error: 'Something failed',
    }));

    const summary = store.getWorkspaceSummary('ws-agg');
    expect(summary.totalEvents).toBe(2);
    expect(summary.errors).toBe(1);

    store.dispose();
  });
});
