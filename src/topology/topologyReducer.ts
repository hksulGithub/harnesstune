import { hierarchy, tree } from 'd3-hierarchy';
import type { AgentEvent } from '../types/agent';
import type { TopologyNode, TopologyEdge, TopologyState } from '../types/topology';

interface NodeData {
  sessionId: string;
  children: NodeData[];
}

/**
 * buildTopology converts a list of AgentEvents into a positioned topology graph.
 *
 * Steps:
 *  A — Build node map from events (SessionStart, SubagentStart, SubagentStop, SessionEnd)
 *  B — Build edges from parent-child relationships
 *  C — Compute layout with d3-hierarchy tree layout (nodeSize [160, 80])
 *  D — Return { nodes, edges }
 */
export function buildTopology(events: AgentEvent[], workspaceFilter?: string): TopologyState {
  // Step A: Build node map from events
  const nodeMap = new Map<string, TopologyNode>();
  // Track which tool use IDs belong to which session
  // (for resolving parentToolUseId -> parentSessionId)
  const toolUseToSession = new Map<string, string>();

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of sorted) {
    if (workspaceFilter && event.workspaceId !== workspaceFilter) {
      continue;
    }

    const raw = event.raw as Record<string, unknown> | null ?? {};

    if (event.eventType === 'SessionStart') {
      // Dedup: skip if node already exists
      if (nodeMap.has(event.sessionId)) { continue; }

      const node: TopologyNode = {
        sessionId: event.sessionId,
        parentSessionId: null,
        workspaceId: event.workspaceId,
        agentRole: (raw['agentRole'] as string | undefined) ?? null,
        model: event.model ?? null,
        status: 'running',
        opacity: 1.0,
        x: 0,
        y: 0,
        startedAt: event.timestamp,
        stoppedAt: null,
      };
      nodeMap.set(event.sessionId, node);

    } else if (event.eventType === 'SubagentStart') {
      // Dedup: skip if node already exists
      if (nodeMap.has(event.sessionId)) { continue; }

      // Resolve parentSessionId from parentToolUseId
      let parentSessionId: string | null = null;
      if (event.parentToolUseId) {
        parentSessionId = toolUseToSession.get(event.parentToolUseId) ?? null;
      }

      // Fallback: use most recently created running node in same workspace
      if (!parentSessionId) {
        let latestStart = -1;
        for (const [sid, n] of nodeMap.entries()) {
          if (sid !== event.sessionId && n.workspaceId === event.workspaceId && n.status === 'running' && n.startedAt > latestStart) {
            latestStart = n.startedAt;
            parentSessionId = sid;
          }
        }
      }

      const node: TopologyNode = {
        sessionId: event.sessionId,
        parentSessionId,
        workspaceId: event.workspaceId,
        agentRole: (raw['agentRole'] as string | undefined) ?? null,
        model: event.model ?? null,
        status: 'running',
        opacity: 1.0,
        x: 0,
        y: 0,
        startedAt: event.timestamp,
        stoppedAt: null,
      };
      nodeMap.set(event.sessionId, node);

    } else if (event.eventType === 'SubagentStop') {
      const node = nodeMap.get(event.sessionId);
      if (node) {
        node.status = 'stopped';
        node.opacity = 0.5;
        node.stoppedAt = event.timestamp;
      }

    } else if (event.eventType === 'SessionEnd' || event.eventType === 'Stop') {
      const root = nodeMap.get(event.sessionId);
      if (root) {
        // Find all descendants of this root
        const toStop = findDescendants(event.sessionId, nodeMap);
        toStop.push(event.sessionId);
        for (const sid of toStop) {
          const n = nodeMap.get(sid);
          if (n) {
            n.status = 'stopped';
            n.opacity = 0.5;
            if (!n.stoppedAt) { n.stoppedAt = event.timestamp; }
          }
        }
      }
    }

    // Track tool use IDs for parentToolUseId resolution
    if (event.toolName && event.id) {
      toolUseToSession.set(event.id, event.sessionId);
    }
  }

  // Step B: Build edges
  const edges: TopologyEdge[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSessionId) {
      edges.push({
        id: `${node.parentSessionId}->${node.sessionId}`,
        sourceSessionId: node.parentSessionId,
        targetSessionId: node.sessionId,
        isActive: node.status === 'running',
        status: node.status,
      });
    }
  }

  // Step C: Compute layout with d3-hierarchy
  // Group nodes by root session (nodes with parentSessionId === null)
  const roots = [...nodeMap.values()].filter(n => n.parentSessionId === null);
  const treeLayout = tree<NodeData>().nodeSize([160, 80]);

  let xOffset = 0;

  for (const root of roots) {
    const nodeData = buildNodeData(root.sessionId, nodeMap);
    const h = hierarchy(nodeData);
    const positioned = treeLayout(h);

    // Find the leftmost x to offset correctly
    let minX = Infinity;
    let maxX = -Infinity;
    positioned.each(d => {
      if (d.x < minX) { minX = d.x; }
      if (d.x > maxX) { maxX = d.x; }
    });

    const treeWidth = maxX - minX;

    positioned.each(d => {
      const n = nodeMap.get(d.data.sessionId);
      if (n) {
        // Center tree horizontally: shift by -minX + xOffset
        n.x = d.x - minX + xOffset;
        n.y = d.y;
      }
    });

    xOffset += treeWidth + 200;
  }

  const nodes = [...nodeMap.values()];
  return { nodes, edges };
}

/** Build a recursive NodeData structure for d3.hierarchy() */
function buildNodeData(sessionId: string, nodeMap: Map<string, TopologyNode>): NodeData {
  const children: NodeData[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSessionId === sessionId) {
      children.push(buildNodeData(node.sessionId, nodeMap));
    }
  }
  return { sessionId, children };
}

/** Find all descendant session IDs for a given root session ID */
function findDescendants(sessionId: string, nodeMap: Map<string, TopologyNode>): string[] {
  const result: string[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSessionId === sessionId) {
      result.push(node.sessionId);
      result.push(...findDescendants(node.sessionId, nodeMap));
    }
  }
  return result;
}
