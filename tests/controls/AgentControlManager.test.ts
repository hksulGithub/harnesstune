import { AgentControlManager } from '../../src/controls/AgentControlManager';
import type { AgentSession } from '../../src/types/agent';

describe('AgentControlManager', () => {
  let manager: AgentControlManager;

  beforeEach(() => {
    manager = new AgentControlManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('pause: sets controlState to paused and isPaused returns true', () => {
    manager.registerSession('sess-1', 'ws-1');
    expect(manager.isPaused('sess-1')).toBe(false);

    manager.pauseAgent('sess-1');

    const session = manager.getSession('sess-1');
    expect(session?.controlState).toBe('paused');
    expect(session?.pausedAt).toBeDefined();
    expect(manager.isPaused('sess-1')).toBe(true);
  });

  it('resume: restores running state and clears pausedAt', () => {
    manager.registerSession('sess-2', 'ws-1');
    manager.pauseAgent('sess-2');
    expect(manager.isPaused('sess-2')).toBe(true);

    manager.resumeAgent('sess-2');

    const session = manager.getSession('sess-2');
    expect(session?.controlState).toBe('running');
    expect(session?.pausedAt).toBeUndefined();
    expect(manager.isPaused('sess-2')).toBe(false);
  });

  it('stop: sends SIGTERM to pid and sets controlState to stopping', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true as never);

    manager.registerSession('sess-3', 'ws-1');
    manager.updateSessionPid('sess-3', 12345);

    manager.stopAgent('sess-3');

    // Should check if alive first (signal 0), then send SIGTERM
    expect(killSpy).toHaveBeenCalledWith(12345, 0);
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');

    const session = manager.getSession('sess-3');
    expect(session?.controlState).toBe('stopping');

    killSpy.mockRestore();
  });

  it('stop without pid: does not throw and sets controlState to stopping', () => {
    manager.registerSession('sess-4', 'ws-1');

    expect(() => manager.stopAgent('sess-4')).not.toThrow();

    const session = manager.getSession('sess-4');
    expect(session?.controlState).toBe('stopping');
  });

  it('fires onDidChangeSession event on state transition', (done) => {
    manager.registerSession('sess-5', 'ws-1');

    let eventCount = 0;
    const events: AgentSession[] = [];

    manager.onDidChangeSession((s) => {
      events.push(s);
      eventCount++;
      if (eventCount >= 1) {
        expect(events[0].controlState).toBe('paused');
        done();
      }
    });

    manager.pauseAgent('sess-5');
  });

  it('getSessionsForWorkspace: filters by workspaceId', () => {
    manager.registerSession('sess-ws1-a', 'workspace-A');
    manager.registerSession('sess-ws1-b', 'workspace-A');
    manager.registerSession('sess-ws2-a', 'workspace-B');

    const wsSessions = manager.getSessionsForWorkspace('workspace-A');
    expect(wsSessions.length).toBe(2);
    expect(wsSessions.every((s) => s.workspaceId === 'workspace-A')).toBe(true);
  });

  it('getAllSessions: returns all registered sessions', () => {
    manager.registerSession('sess-all-1', 'ws-1');
    manager.registerSession('sess-all-2', 'ws-2');

    const all = manager.getAllSessions();
    expect(all.length).toBe(2);
  });

  it('pauseAgent: throws when session not found', () => {
    expect(() => manager.pauseAgent('no-such-session')).toThrow();
  });

  it('resumeAgent: throws when session is not paused', () => {
    manager.registerSession('sess-nopaused', 'ws-1');
    expect(() => manager.resumeAgent('sess-nopaused')).toThrow();
  });
});
