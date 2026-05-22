import { mergeWorkspaceSummaries } from '../../src/providers/fleetBuilder';
import type { FleetWorkspaceSummary } from '../../src/types/fleet';

function summary(overrides: Partial<FleetWorkspaceSummary>): FleetWorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Local Workspace',
    platform: 'claude-code',
    health: 'healthy',
    agentCount: 1,
    errorRatePct: 0,
    lastActivityTs: 100,
    ...overrides,
  };
}

describe('mergeWorkspaceSummaries', () => {
  it('deduplicates local and relay shadow workspaces by id while surfacing relay status', () => {
    const local = summary({
      id: 'ws-overlap',
      name: 'Local Workspace',
      platform: 'claude-code',
      health: 'healthy',
      agentCount: 2,
    });
    const relayShadow = summary({
      id: 'ws-overlap',
      name: 'Relay Shadow',
      platform: 'relay',
      health: 'unreachable',
      agentCount: 0,
    });
    const relayOnly = summary({
      id: 'ws-remote',
      name: 'Remote Workspace',
      platform: 'relay',
      health: 'degraded',
      agentCount: 1,
    });

    const merged = mergeWorkspaceSummaries([local], [relayShadow, relayOnly]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'ws-overlap',
      name: 'Local Workspace',
      platform: 'claude-code',
      health: 'healthy',
      agentCount: 2,
      relayStatus: 'unreachable',
    });
    expect(merged[1]).toMatchObject({
      id: 'ws-remote',
      name: 'Remote Workspace',
      platform: 'relay',
      health: 'degraded',
    });
  });
});
