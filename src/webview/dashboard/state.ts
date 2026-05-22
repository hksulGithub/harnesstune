import type { FleetWorkspaceSummary, FleetWorkspaceDetail } from '../../types/fleet.js';
import type { WebviewToHostMessage } from '../../types/messages.js';

export type DashboardViewLevel = 'fleet' | 'workspace' | 'agent';

export interface DashboardNavigationState {
  level: DashboardViewLevel;
  workspaceId?: string;
  workspaceName?: string;
  agentId?: string;
  agentName?: string;
}

export interface DashboardPersistedState {
  nav: DashboardNavigationState;
  days: number;
}

export function restoreDashboardState(saved: DashboardPersistedState | null | undefined): DashboardPersistedState {
  return {
    nav: saved?.nav ?? { level: 'fleet' },
    days: saved?.days ?? 7,
  };
}

export function createFleetRequest(
  nav: DashboardNavigationState,
  days: number,
): WebviewToHostMessage | null {
  if (nav.level === 'fleet') {
    return { type: 'fleet:requestOverview', days };
  }

  if (nav.level === 'workspace' && nav.workspaceId !== undefined) {
    return {
      type: 'fleet:requestWorkspaceDetail',
      workspaceId: nav.workspaceId,
      days,
    };
  }

  if (nav.level === 'agent' && nav.workspaceId !== undefined && nav.agentId !== undefined) {
    return {
      type: 'fleet:requestAgentDetail',
      workspaceId: nav.workspaceId,
      agentId: nav.agentId,
      days,
    };
  }

  return null;
}

export function selectWorkspace(
  summaries: FleetWorkspaceSummary[],
  workspaceId: string,
): DashboardNavigationState {
  const ws = summaries.find((summary) => summary.id === workspaceId);
  return {
    level: 'workspace',
    workspaceId,
    workspaceName: ws?.name ?? workspaceId,
  };
}

export function selectAgent(
  nav: DashboardNavigationState,
  workspaceDetail: FleetWorkspaceDetail | null,
  agentId: string,
): DashboardNavigationState {
  const agent = workspaceDetail?.agents.find((summary) => summary.id === agentId);
  return {
    level: 'agent',
    workspaceId: nav.workspaceId,
    workspaceName: nav.workspaceName,
    agentId,
    agentName: agent?.name ?? agentId,
  };
}

export function navigateFleet(): DashboardNavigationState {
  return { level: 'fleet' };
}

export function navigateWorkspace(nav: DashboardNavigationState): DashboardNavigationState {
  return {
    level: 'workspace',
    workspaceId: nav.workspaceId,
    workspaceName: nav.workspaceName,
  };
}
