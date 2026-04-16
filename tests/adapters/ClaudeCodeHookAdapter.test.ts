import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// We test the injection/removal logic directly without starting a real server
// by creating a subclass that exposes the private settingsPath and skips server

// Since ClaudeCodeHookAdapter uses os.homedir() for settingsPath, we need to
// test injectHooks/removeHooks/normalizeEvent directly with a temp path.
// We do this by creating a minimal test harness.

import { ClaudeCodeHookAdapter } from '../../src/adapters/ClaudeCodeHookAdapter';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-adapter-test-'));
}

// Subclass to override settingsPath and storageUri for testing
class TestableAdapter extends ClaudeCodeHookAdapter {
  constructor(storageUri: { fsPath: string }, settingsPath: string) {
    super(storageUri);
    // Override the private settingsPath via Object.defineProperty
    (this as unknown as Record<string, unknown>)['settingsPath'] = settingsPath;
  }
}

describe('ClaudeCodeHookAdapter', () => {
  let tmpDir: string;
  let settingsPath: string;
  let storageUri: { fsPath: string };

  beforeEach(() => {
    tmpDir = makeTempDir();
    settingsPath = path.join(tmpDir, 'settings.json');
    storageUri = { fsPath: tmpDir };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('idempotent inject — double inject does not duplicate entries', () => {
    const adapter = new TestableAdapter(storageUri, settingsPath);
    const hookUrl = 'http://127.0.0.1:12345/hook?token=abc';

    adapter.injectHooks(hookUrl);
    adapter.injectHooks(hookUrl); // second inject

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooks = settings.hooks as Record<string, unknown[]>;

    // Each event should have exactly one _harnesstune entry
    for (const eventName of ClaudeCodeHookAdapter.HOOK_EVENTS) {
      const entries = hooks[eventName];
      expect(entries).toBeDefined();
      const harnessEntries = entries.filter(
        (e: unknown) => e && typeof e === 'object' && '_harnesstune' in (e as object)
      );
      expect(harnessEntries.length).toBe(1);
    }

    adapter.dispose();
  });

  it('clean disconnect — removeHooks removes only _harnesstune entries, user hooks preserved', () => {
    const adapter = new TestableAdapter(storageUri, settingsPath);
    const hookUrl = 'http://127.0.0.1:12345/hook?token=abc';

    // Set up initial settings with user hooks
    const initialSettings = {
      hooks: {
        PreToolUse: [
          { type: 'command', command: 'echo "user hook"' },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2));

    adapter.injectHooks(hookUrl);

    // Verify harnesstune entries are there
    const afterInject = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUseAfterInject = afterInject.hooks.PreToolUse as unknown[];
    expect(preToolUseAfterInject.some((e: unknown) => (e as Record<string, unknown>)._harnesstune)).toBe(true);

    adapter.removeHooks();

    // Verify user hooks preserved, harnesstune entries removed
    const afterRemove = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUseAfterRemove = (afterRemove.hooks?.PreToolUse ?? []) as unknown[];
    expect(preToolUseAfterRemove.some((e: unknown) => (e as Record<string, unknown>)._harnesstune)).toBe(false);
    expect(preToolUseAfterRemove.some((e: unknown) => (e as Record<string, unknown>).command === 'echo "user hook"')).toBe(true);

    adapter.dispose();
  });

  it('normalize event — maps raw SessionStart payload to AgentEvent', () => {
    const adapter = new TestableAdapter(storageUri, settingsPath);
    const raw = {
      event: 'SessionStart',
      session_id: 'sess_abc',
      timestamp: '2026-04-16T10:00:00Z',
      model: 'claude-opus-4-5',
    };

    const event = adapter.normalizeEvent('workspace-1', raw);

    expect(event.eventType).toBe('SessionStart');
    expect(event.sessionId).toBe('sess_abc');
    expect(event.agentId).toBe('sess_abc');
    expect(event.workspaceId).toBe('workspace-1');
    expect(event.model).toBe('claude-opus-4-5');
    expect(typeof event.id).toBe('string');
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.timestamp).toBe(Date.parse('2026-04-16T10:00:00Z'));
    expect(event.raw).toBe(raw);

    adapter.dispose();
  });

  it('creates backup before first write', () => {
    const adapter = new TestableAdapter(storageUri, settingsPath);
    const hookUrl = 'http://127.0.0.1:12345/hook?token=abc';

    // Create initial settings file
    const initialSettings = { version: 1 };
    fs.writeFileSync(settingsPath, JSON.stringify(initialSettings));

    adapter.injectHooks(hookUrl);

    const backupPath = settingsPath + '.harnesstune-backup';
    expect(fs.existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    expect(backup).toEqual(initialSettings);

    adapter.dispose();
  });
});
