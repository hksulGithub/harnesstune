import * as vscode from 'vscode';
import { NotificationService } from '../../src/notifications/NotificationService';
import type { AgentEvent } from '../../src/types/agent';
import type { IWorkspaceRegistry } from '../../src/types/workspace';
import type { WorkspaceRecord } from '../../src/types/workspace';

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'evt-001',
    workspaceId: 'ws-notif-1',
    sessionId: 'sess-notif-1',
    agentId: 'agent-001',
    eventType: 'PostToolUse',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  };
}

function makeRegistry(errorCount = 0, runningAgentCount = 1): IWorkspaceRegistry {
  const record: WorkspaceRecord = {
    id: 'ws-notif-1',
    name: 'Test Workspace',
    rootPath: '/tmp/test',
    status: 'running',
    addedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    runningAgentCount,
    errorCount,
  };

  return {
    getAll: () => [record],
    getById: (id: string) => (id === 'ws-notif-1' ? record : undefined),
    add: async () => record,
    remove: async () => {},
    update: jest.fn().mockResolvedValue(undefined),
    onDidChange: ((_: unknown) => ({ dispose: () => {} })) as unknown as vscode.Event<WorkspaceRecord[]>,
  };
}

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('error event routes to showErrorMessage for PostToolUseFailure', async () => {
    const showErrorSpy = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    const registry = makeRegistry();
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'PostToolUseFailure', error: 'Tool exploded' });
    await service.handleEvent(event);

    expect(showErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('agent-001'),
      'View Details'
    );
    expect(showErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Tool exploded'),
      'View Details'
    );

    service.dispose();
  });

  it('error event routes to showErrorMessage for StopFailure', async () => {
    const showErrorSpy = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    const registry = makeRegistry();
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'StopFailure', error: 'Could not stop' });
    await service.handleEvent(event);

    expect(showErrorSpy).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  it('info event does not show toast for SessionStart', async () => {
    const showErrorSpy = jest.spyOn(vscode.window, 'showErrorMessage');
    const registry = makeRegistry();
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'SessionStart' });
    await service.handleEvent(event);

    expect(showErrorSpy).not.toHaveBeenCalled();

    service.dispose();
  });

  it('info event does not show toast for SessionEnd', async () => {
    const showErrorSpy = jest.spyOn(vscode.window, 'showErrorMessage');
    const registry = makeRegistry();
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'SessionEnd' });
    await service.handleEvent(event);

    expect(showErrorSpy).not.toHaveBeenCalled();

    service.dispose();
  });

  it('error increments workspace errorCount via registry.update', async () => {
    jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    const registry = makeRegistry(3); // existing errorCount = 3
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'PostToolUseFailure', error: 'Bad error' });
    await service.handleEvent(event);

    expect(registry.update).toHaveBeenCalledWith('ws-notif-1', { errorCount: 4 });

    service.dispose();
  });

  it('SessionStart updates workspace status and increments runningAgentCount', async () => {
    const registry = makeRegistry(0, 0);
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'SessionStart' });
    await service.handleEvent(event);

    expect(registry.update).toHaveBeenCalledWith('ws-notif-1', expect.objectContaining({
      runningAgentCount: 1,
    }));

    service.dispose();
  });

  it('SessionEnd decrements runningAgentCount', async () => {
    const registry = makeRegistry(0, 2); // 2 running agents
    const service = new NotificationService(registry);

    const event = makeEvent({ eventType: 'SessionEnd' });
    await service.handleEvent(event);

    expect(registry.update).toHaveBeenCalledWith('ws-notif-1', expect.objectContaining({
      runningAgentCount: 1,
    }));

    service.dispose();
  });
});
