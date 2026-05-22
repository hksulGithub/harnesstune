import { buildTopology } from '../../src/topology/topologyReducer';
import type { AgentEvent } from '../../src/types/agent';

// Helper to build minimal AgentEvent objects
function makeEvent(overrides: Partial<AgentEvent> & Pick<AgentEvent, 'eventType' | 'sessionId'>): AgentEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    workspaceId: overrides.workspaceId ?? 'ws-1',
    sessionId: overrides.sessionId,
    agentId: overrides.agentId ?? overrides.sessionId,
    eventType: overrides.eventType,
    timestamp: overrides.timestamp ?? Date.now(),
    toolName: overrides.toolName,
    model: overrides.model,
    parentToolUseId: overrides.parentToolUseId,
    raw: overrides.raw ?? {},
  };
}

describe('buildTopology', () => {
  it('Test 1: returns empty state for empty event list', () => {
    const result = buildTopology([]);
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it('Test 2: single SessionStart returns one root node with status running', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
    ];
    const result = buildTopology(events);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);

    const node = result.nodes[0];
    expect(node.sessionId).toBe('root-1');
    expect(node.parentSessionId).toBeNull();
    expect(node.status).toBe('running');
    expect(node.opacity).toBe(1.0);
    // Root node is positioned by the deterministic tree layout
    expect(typeof node.x).toBe('number');
    expect(typeof node.y).toBe('number');
  });

  it('Test 3: SessionStart + SubagentStart produces two nodes and one edge', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2000 }),
    ];
    const result = buildTopology(events);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);

    const edge = result.edges[0];
    expect(edge.sourceSessionId).toBe('root-1');
    expect(edge.targetSessionId).toBe('child-1');
    expect(edge.isActive).toBe(true);
  });

  it('Test 4: SubagentStop sets child status to stopped and opacity 0.5', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2000 }),
      makeEvent({ eventType: 'SubagentStop', sessionId: 'child-1', timestamp: 3000 }),
    ];
    const result = buildTopology(events);

    const child = result.nodes.find(n => n.sessionId === 'child-1');
    expect(child).toBeDefined();
    expect(child!.status).toBe('stopped');
    expect(child!.opacity).toBe(0.5);

    // Edge should reflect stopped state
    const edge = result.edges.find(e => e.targetSessionId === 'child-1');
    expect(edge!.isActive).toBe(false);
    expect(edge!.status).toBe('stopped');
  });

  it('Test 5: SessionEnd sets root and all descendants to stopped', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'grandchild-1', timestamp: 3000 }),
      makeEvent({ eventType: 'SessionEnd', sessionId: 'root-1', timestamp: 5000 }),
    ];
    const result = buildTopology(events);

    for (const node of result.nodes) {
      expect(node.status).toBe('stopped');
      expect(node.opacity).toBe(0.5);
    }
  });

  it('Test 6: Two independent sessions produce separate root nodes with no cross-tree edges', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-A', workspaceId: 'ws-A', timestamp: 1000 }),
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-B', workspaceId: 'ws-B', timestamp: 2000 }),
    ];
    const result = buildTopology(events);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);

    const nodeA = result.nodes.find(n => n.sessionId === 'root-A');
    const nodeB = result.nodes.find(n => n.sessionId === 'root-B');
    expect(nodeA!.parentSessionId).toBeNull();
    expect(nodeB!.parentSessionId).toBeNull();
  });

  it('Test 7: Duplicate SubagentStart with same sessionId produces only one node', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2001 }), // duplicate
    ];
    const result = buildTopology(events);
    const childNodes = result.nodes.filter(n => n.sessionId === 'child-1');
    expect(childNodes).toHaveLength(1);
  });

  it('Test 8: tree layout produces y-coordinates increasing with depth (child.y > root.y)', () => {
    const events = [
      makeEvent({ eventType: 'SessionStart', sessionId: 'root-1', timestamp: 1000 }),
      makeEvent({ eventType: 'SubagentStart', sessionId: 'child-1', timestamp: 2000 }),
    ];
    const result = buildTopology(events);

    const root = result.nodes.find(n => n.sessionId === 'root-1')!;
    const child = result.nodes.find(n => n.sessionId === 'child-1')!;

    expect(child.y).toBeGreaterThan(root.y);
  });
});
