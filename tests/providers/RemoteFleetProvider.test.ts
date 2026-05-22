import { RemoteFleetProvider } from '../../src/providers/RemoteFleetProvider';
import type { RelayClient } from '../../src/relay/RelayClient';
import type { IWorkspaceRegistry, WorkspaceRecord } from '../../src/types/workspace';

function makeRemoteWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'ws-remote',
    name: 'Remote Workspace',
    rootPath: 'remote://channel-1',
    status: 'running',
    addedAt: '2026-05-09T00:00:00.000Z',
    lastUpdatedAt: '2026-05-09T00:00:00.000Z',
    runningAgentCount: 0,
    errorCount: 0,
    backendType: 'remote',
    mode: 'remote',
    relayUrl: 'https://relay.example/api',
    channelId: 'channel-1',
    agents: [],
    ...overrides,
  };
}

function makeRegistry(workspaces: WorkspaceRecord[]): IWorkspaceRegistry {
  return {
    getAll: () => workspaces,
    getById: (id: string) => workspaces.find(ws => ws.id === id),
    add: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    onDidChange: jest.fn(),
  } as unknown as IWorkspaceRegistry;
}

describe('RemoteFleetProvider', () => {
  it('marks relay summary failures as unreachable instead of no-data', async () => {
    const relayClient = {
      getSummary: jest.fn().mockRejectedValue(new Error('relay down')),
    } as unknown as RelayClient;
    const provider = new RemoteFleetProvider(
      new Map([['ws-remote', relayClient]]),
      makeRegistry([makeRemoteWorkspace()]),
    );

    const summaries = await provider.getWorkspaceSummaries(7);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'ws-remote',
      name: 'Remote Workspace',
      health: 'unreachable',
      agentCount: 0,
      errorRatePct: 0,
      lastActivityTs: 0,
    });
  });
});
