import type { AgentEvent } from '../types/agent';
import type { TopologyNode, TopologyEdge, TopologyState } from '../types/topology';

interface NodeData {
  sessionId: string;
  children: NodeData[];
}

/**
 * buildTopology converts a list of AgentEvents into a positioned topology graph.
 *
 * Claude Code does NOT fire SessionStart/SubagentStart hooks. Root session nodes
 * are inferred from the first event seen for each session_id (typically PreToolUse).
 *
 * Parent-child linking: Claude Code hook payloads do NOT include parent_tool_use_id.
 * Instead, we detect when a session uses tool_name="Agent" (PreToolUse) and link
 * the next new session_id that appears as its child.
 *
 * Steps:
 *  A — Build node map from events, track pending Agent tool uses for parent linking
 *  B — Build edges from parent-child relationships
 *  C — Compute a deterministic tree layout (nodeSize [160, 80])
 *  D — Return { nodes, edges }
 */
export function buildTopology(events: AgentEvent[], workspaceFilter?: string, knownSessionIds?: Set<string>): TopologyState {
  // Step A: Build node map from events
  const nodeMap = new Map<string, TopologyNode>();

  // Pending Agent tool invocations: when a session fires PreToolUse with
  // tool_name="Agent", we push { parentSessionId, toolUseId, timestamp } here.
  // When a new session_id first appears, we pop the oldest pending entry
  // from the same workspace and set it as the parent.
  const pendingAgentSpawns: Array<{
    parentSessionId: string;
    toolUseId: string;
    timestamp: number;
    workspaceId: string;
  }> = [];
  const latestSessionByWorkspace = new Map<string, string>();

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of sorted) {
    if (workspaceFilter && event.workspaceId !== workspaceFilter) {
      continue;
    }
    if (knownSessionIds && !knownSessionIds.has(event.sessionId)) {
      continue;
    }

    const raw = event.raw as Record<string, unknown> | null ?? {};

    // Track Agent tool spawns: PreToolUse with tool_name="Agent" means
    // this session is about to spawn a subagent
    if (event.eventType === 'PreToolUse' && event.toolName === 'Agent') {
      pendingAgentSpawns.push({
        parentSessionId: event.sessionId,
        toolUseId: event.id,
        timestamp: event.timestamp,
        workspaceId: event.workspaceId,
      });
    }

    if (event.eventType === 'SessionEnd' || event.eventType === 'Stop' || event.eventType === 'SubagentStop') {
      // Skip stop events for sessions we never saw start — avoids stale ghost nodes
      if (!nodeMap.has(event.sessionId)) {
        continue;
      }
      // Mark this session and all descendants as stopped
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

    } else {
      // Any event (PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, etc.)
      // Auto-create node on first-seen event for this session
      if (!nodeMap.has(event.sessionId)) {
        // Try to match this new session to a pending Agent spawn
        let parentSessionId: string | null = null;
        const spawnIdx = pendingAgentSpawns.findIndex(
          s => s.workspaceId === event.workspaceId && s.parentSessionId !== event.sessionId
        );
        if (spawnIdx !== -1) {
          parentSessionId = pendingAgentSpawns[spawnIdx].parentSessionId;
          pendingAgentSpawns.splice(spawnIdx, 1);
        } else if (event.eventType === 'SubagentStart') {
          parentSessionId = latestSessionByWorkspace.get(event.workspaceId) ?? null;
        }

        nodeMap.set(event.sessionId, {
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
        });
      }
      latestSessionByWorkspace.set(event.workspaceId, event.sessionId);
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

  // Step C: Compute deterministic tree layout
  // Group nodes by root session (nodes with parentSessionId === null)
  const roots = [...nodeMap.values()].filter(n => n.parentSessionId === null);

  let xOffset = 0;

  for (const root of roots) {
    const nodeData = buildNodeData(root.sessionId, nodeMap);
    const positioned = layoutTree(nodeData);

    // Find the leftmost x to offset correctly
    let minX = Infinity;
    let maxX = -Infinity;
    for (const d of positioned) {
      if (d.x < minX) { minX = d.x; }
      if (d.x > maxX) { maxX = d.x; }
    }

    const treeWidth = maxX - minX;

    for (const d of positioned) {
      const n = nodeMap.get(d.data.sessionId);
      if (n) {
        // Center tree horizontally: shift by -minX + xOffset
        n.x = d.x - minX + xOffset;
        n.y = d.y;
      }
    }

    xOffset += treeWidth + 200;
  }

  const nodes = [...nodeMap.values()];

  return { nodes, edges };
}

/** Build a recursive NodeData structure for tree layout */
function buildNodeData(sessionId: string, nodeMap: Map<string, TopologyNode>): NodeData {
  const children: NodeData[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSessionId === sessionId) {
      children.push(buildNodeData(node.sessionId, nodeMap));
    }
  }
  return { sessionId, children };
}

function layoutTree(root: NodeData): Array<{ data: NodeData; x: number; y: number }> {
  const positioned: Array<{ data: NodeData; x: number; y: number }> = [];
  let leafIndex = 0;

  const visit = (node: NodeData, depth: number): number => {
    if (node.children.length === 0) {
      const x = leafIndex * 160;
      leafIndex += 1;
      positioned.push({ data: node, x, y: depth * 80 });
      return x;
    }

    const childXs = node.children.map(child => visit(child, depth + 1));
    const x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    positioned.push({ data: node, x, y: depth * 80 });
    return x;
  };

  visit(root, 0);
  return positioned;
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
