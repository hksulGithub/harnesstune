import type { WorkspaceRecord, WorkspaceStatus } from './workspace';
import type { AgentEvent, AgentSession } from './agent';
import type { TopologyState, TopologyNode } from './topology';

/** Messages from extension host to webview */
export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord }
  | { type: 'dashboard:agentEvents'; events: AgentEvent[] }
  | { type: 'dashboard:agentUpdate'; session: AgentSession }
  | { type: 'dashboard:summary'; workspaceId: string; totalAgents: number; running: number; paused: number; errors: number; estimatedCost: number }
  | { type: 'schematic:topologyUpdate'; state: TopologyState }
  | { type: 'schematic:nodeUpdate'; node: TopologyNode }
  | { type: 'schematic:nodeDetail'; session: AgentSession | null; events: AgentEvent[] };

/** Messages from webview to extension host */
export type WebviewToHostMessage =
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' }
  | { type: 'agent:pause'; sessionId: string }
  | { type: 'agent:resume'; sessionId: string }
  | { type: 'agent:stop'; sessionId: string }
  | { type: 'dashboard:requestState'; workspaceId?: string }
  | { type: 'schematic:requestState'; workspaceId?: string }
  | { type: 'schematic:selectNode'; sessionId: string };
