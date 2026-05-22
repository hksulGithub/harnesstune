import type { AgentControlState } from './agent';

export interface TopologyNode {
  sessionId: string;
  parentSessionId: string | null;
  workspaceId: string;
  agentRole: string | null;
  model: string | null;
  status: AgentControlState;
  opacity: number;          // 1.0 for active, 0.5 for completed
  x: number;                // computed by topology layout
  y: number;                // computed by topology layout
  startedAt: number;
  stoppedAt: number | null;
}

export interface TopologyEdge {
  id: string;               // `${sourceSessionId}->${targetSessionId}`
  sourceSessionId: string;
  targetSessionId: string;
  isActive: boolean;        // true if child is running
  status: AgentControlState;
}

export interface TopologyState {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}
