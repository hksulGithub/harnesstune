import {
  createFleetRequest,
  navigateFleet,
  navigateWorkspace,
  restoreDashboardState,
  selectAgent,
  selectWorkspace,
} from '../../src/webview/dashboard/state';
import type { FleetWorkspaceDetail, FleetWorkspaceSummary } from '../../src/types/fleet';

describe('dashboard state helpers', () => {
  const summaries: FleetWorkspaceSummary[] = [
    {
      id: 'ws-local',
      name: 'Local Workspace',
      platform: 'claude-code',
      health: 'healthy',
      agentCount: 1,
      errorRatePct: 0,
      lastActivityTs: 1,
    },
  ];

  const detail: FleetWorkspaceDetail = {
    agents: [{
      id: 'agent-1',
      name: 'Cron Agent',
      health: 'healthy',
      successRatePct: 100,
      lastRunTs: 1,
      costUsd: 0,
      costTrend: 'flat',
    }],
    cost: { totalCostUsd: 0, totalTokens: 0, trend: 'flat' },
  };

  it('restores saved navigation and date range with fleet defaults', () => {
    expect(restoreDashboardState(null)).toEqual({
      nav: { level: 'fleet' },
      days: 7,
    });

    expect(restoreDashboardState({
      nav: { level: 'workspace', workspaceId: 'ws-local', workspaceName: 'Local Workspace' },
      days: 30,
    })).toEqual({
      nav: { level: 'workspace', workspaceId: 'ws-local', workspaceName: 'Local Workspace' },
      days: 30,
    });
  });

  it('creates host requests for every navigation level while preserving days', () => {
    expect(createFleetRequest({ level: 'fleet' }, 7)).toEqual({
      type: 'fleet:requestOverview',
      days: 7,
    });

    expect(createFleetRequest({ level: 'workspace', workspaceId: 'ws-local' }, 30)).toEqual({
      type: 'fleet:requestWorkspaceDetail',
      workspaceId: 'ws-local',
      days: 30,
    });

    expect(createFleetRequest({ level: 'agent', workspaceId: 'ws-local', agentId: 'agent-1' }, 3)).toEqual({
      type: 'fleet:requestAgentDetail',
      workspaceId: 'ws-local',
      agentId: 'agent-1',
      days: 3,
    });
  });

  it('derives workspace and agent navigation labels from loaded data', () => {
    const workspaceNav = selectWorkspace(summaries, 'ws-local');
    expect(workspaceNav).toEqual({
      level: 'workspace',
      workspaceId: 'ws-local',
      workspaceName: 'Local Workspace',
    });

    const agentNav = selectAgent(workspaceNav, detail, 'agent-1');
    expect(agentNav).toEqual({
      level: 'agent',
      workspaceId: 'ws-local',
      workspaceName: 'Local Workspace',
      agentId: 'agent-1',
      agentName: 'Cron Agent',
    });
  });

  it('supports breadcrumb navigation back to fleet and workspace', () => {
    const agentNav = {
      level: 'agent' as const,
      workspaceId: 'ws-local',
      workspaceName: 'Local Workspace',
      agentId: 'agent-1',
      agentName: 'Cron Agent',
    };

    expect(navigateFleet()).toEqual({ level: 'fleet' });
    expect(navigateWorkspace(agentNav)).toEqual({
      level: 'workspace',
      workspaceId: 'ws-local',
      workspaceName: 'Local Workspace',
    });
  });
});
