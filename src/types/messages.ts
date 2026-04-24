import type { WorkspaceRecord, WorkspaceStatus } from './workspace';
import type { AgentEvent, AgentSession } from './agent';
import type { TopologyState, TopologyNode } from './topology';
import type { ChatMessage, SessionState } from '../session';
import type { ReportEnvelope, TimelineItem, RalphReportBody } from '@harnesstune/shared';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from './fleet';

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
  | { type: 'schematic:nodeDetail'; session: AgentSession | null; events: AgentEvent[] }
  | { type: 'workspace:setActive'; workspaceId: string }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:stateChange'; state: SessionState }
  | { type: 'chat:history'; messages: ChatMessage[] }
  | { type: 'chat:workspaceInfo'; workspaceId: string; workspaceName: string }
  | { type: 'chat:triggerInterrupt' }
  | { type: 'chat:setReadOnly'; reason: string }
  | { type: 'reports:list'; workspaceId: string; reports: ReportEnvelope[] }
  | { type: 'reports:detail'; workspaceId: string; report: ReportEnvelope }
  | { type: 'reports:messageSent'; workspaceId: string; success: boolean }
  | { type: 'timeline:update'; workspaceId: string; items: TimelineItem[]; hasMore: boolean }
  | { type: 'timeline:loopIterations'; workspaceId: string; loopIterations: Record<string, RalphReportBody[]> }
  | { type: 'timeline:append'; workspaceId: string; items: TimelineItem[] }
  | { type: 'timeline:connectionStatus'; workspaceId: string; status: 'connected' | 'stale' | 'error' }
  | { type: 'fleet:overview'; summaries: FleetWorkspaceSummary[] }
  | { type: 'fleet:workspaceDetail'; workspaceId: string; detail: FleetWorkspaceDetail }
  | { type: 'fleet:agentDetail'; workspaceId: string; agentId: string; detail: FleetAgentDetail }
  | { type: 'fleet:error'; scope: 'fleet' | 'workspace' | 'agent'; message: string };

/** Messages from webview to extension host */
export type WebviewToHostMessage =
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:configure'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' }
  | { type: 'agent:pause'; sessionId: string }
  | { type: 'agent:resume'; sessionId: string }
  | { type: 'agent:stop'; sessionId: string }
  | { type: 'dashboard:requestState'; workspaceId?: string }
  | { type: 'schematic:requestState'; workspaceId?: string }
  | { type: 'schematic:selectNode'; sessionId: string }
  | { type: 'chat:sendMessage'; text: string }
  | { type: 'chat:interrupt' }
  | { type: 'chat:requestHistory' }
  | { type: 'workspace:addRemote'; relayUrl: string; token: string }
  | { type: 'reports:request'; workspaceId: string; since?: string }
  | { type: 'reports:sendMessage'; workspaceId: string; text: string }
  | { type: 'workspace:messageAgent'; workspaceId: string }
  | { type: 'timeline:requestInitial'; workspaceId: string }
  | { type: 'timeline:loadMore'; workspaceId: string; before: string }
  | { type: 'timeline:sendMessage'; workspaceId: string; text: string; inReplyToReportId?: string }
  | { type: 'fleet:requestOverview'; days: number }
  | { type: 'fleet:requestWorkspaceDetail'; workspaceId: string; days: number }
  | { type: 'fleet:requestAgentDetail'; workspaceId: string; agentId: string; days: number };
