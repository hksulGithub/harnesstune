import { AdapterRegistry } from '../../src/adapters/AdapterRegistry';
import type { AdapterFactory, WorkspaceConnectionConfig } from '../../src/adapters/AdapterFactory';
import type { AgentBackendAdapter } from '../../src/adapters/AgentBackendAdapter';

function makeMockAdapter(): AgentBackendAdapter {
  return {
    id: 'mock',
    name: 'Mock Adapter',
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    onDidReceiveEvent: jest.fn() as unknown as AgentBackendAdapter['onDidReceiveEvent'],
    dispose: jest.fn(),
  };
}

describe('AdapterRegistry', () => {
  test('Test 1: register + create returns adapter from registered factory', () => {
    const registry = new AdapterRegistry();
    const mockAdapter = makeMockAdapter();
    const factory: AdapterFactory = {
      createAdapter: () => mockAdapter,
    };

    registry.register('claude-code', factory);

    const config: WorkspaceConnectionConfig = {
      backendType: 'claude-code',
      host: 'localhost',
    };

    const result = registry.create(config);
    expect(result).toBe(mockAdapter);
  });

  test('Test 2: create throws for unregistered backendType', () => {
    const registry = new AdapterRegistry();

    const config: WorkspaceConnectionConfig = {
      backendType: 'openclaw',
      host: 'localhost',
    };

    // Force unknown type for test
    (config as unknown as { backendType: string }).backendType = 'unknown-type';

    expect(() => registry.create(config as WorkspaceConnectionConfig)).toThrow(
      'No adapter factory registered for backendType: unknown-type'
    );
  });

  test('Test 3: Claude Code factory singleton — two create() calls return the same instance', () => {
    const registry = new AdapterRegistry();
    const mockAdapter = makeMockAdapter();
    const factory: AdapterFactory = {
      createAdapter: () => mockAdapter,
    };

    registry.register('claude-code', factory);

    const config: WorkspaceConnectionConfig = {
      backendType: 'claude-code',
      host: 'localhost',
    };

    const result1 = registry.create(config);
    const result2 = registry.create(config);

    expect(result1).toBe(result2);
  });
});
