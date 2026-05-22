import React, { useEffect, useState } from 'react';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from '../../types/fleet.js';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../types/messages.js';
import vscode from './vscodeApi.js';
import { DateRangeSelector } from './components/DateRangeSelector.js';
import { BreadcrumbBar } from './components/BreadcrumbBar.js';
import { FleetOverview } from './components/FleetOverview.js';
import { WorkspaceDrillDown } from './components/WorkspaceDrillDown.js';
import { AgentDetail } from './components/AgentDetail.js';
import {
  createFleetRequest,
  navigateFleet,
  navigateWorkspace,
  restoreDashboardState,
  selectAgent,
  selectWorkspace,
  type DashboardNavigationState,
  type DashboardPersistedState,
} from './state.js';

function restoreState(): DashboardPersistedState {
  return restoreDashboardState(vscode.getState() as DashboardPersistedState | null);
}

export default function App(): React.ReactElement {
  const initial = restoreState();

  const [nav, setNav] = useState<DashboardNavigationState>(initial.nav);
  const [days, setDays] = useState<number>(initial.days);
  const [summaries, setSummaries] = useState<FleetWorkspaceSummary[]>([]);
  const [workspaceDetail, setWorkspaceDetail] = useState<FleetWorkspaceDetail | null>(null);
  const [agentDetail, setAgentDetail] = useState<FleetAgentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Persist nav + days state on every change
  useEffect(() => {
    vscode.setState({ nav, days } satisfies PersistedState);
  }, [nav, days]);

  // Request data from extension host whenever nav level or days changes
  useEffect(() => {
    setLoading(true);
    setError(null);

    const msg: WebviewToHostMessage | null = createFleetRequest(nav, days);
    if (msg !== null) {
      vscode.postMessage(msg);
    }
  }, [nav.level, nav.workspaceId, nav.agentId, days]);

  // Listen for messages from extension host
  useEffect(() => {
    function handler(event: MessageEvent): void {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'fleet:overview':
          setSummaries(msg.summaries);
          setLoading(false);
          break;
        case 'fleet:workspaceDetail':
          setWorkspaceDetail(msg.detail);
          setLoading(false);
          break;
        case 'fleet:agentDetail':
          setAgentDetail(msg.detail);
          setLoading(false);
          break;
        case 'fleet:error':
          setError(msg.message);
          setLoading(false);
          break;
      }
    }

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Navigation handlers
  function handleSelectWorkspace(id: string): void {
    setNav(selectWorkspace(summaries, id));
  }

  function handleSelectAgent(id: string): void {
    setNav(selectAgent(nav, workspaceDetail, id));
  }

  function handleNavigateFleet(): void {
    setNav(navigateFleet());
  }

  function handleNavigateWorkspace(): void {
    setNav(navigateWorkspace(nav));
  }

  return (
    <div className="dashboard">
      <DateRangeSelector selected={days} onSelect={setDays} />
      <BreadcrumbBar
        workspaceName={nav.level !== 'fleet' ? nav.workspaceName : undefined}
        agentName={nav.level === 'agent' ? nav.agentName : undefined}
        onNavigateFleet={handleNavigateFleet}
        onNavigateWorkspace={handleNavigateWorkspace}
      />
      {nav.level === 'fleet' && (
        <FleetOverview
          summaries={summaries}
          loading={loading}
          error={error}
          onSelectWorkspace={handleSelectWorkspace}
        />
      )}
      {nav.level === 'workspace' && workspaceDetail && (
        <WorkspaceDrillDown
          workspaceName={nav.workspaceName!}
          agents={workspaceDetail.agents}
          cost={workspaceDetail.cost}
          loading={loading}
          error={error}
          onSelectAgent={handleSelectAgent}
        />
      )}
      {nav.level === 'agent' && agentDetail && (
        <AgentDetail
          agentName={nav.agentName!}
          workspaceName={nav.workspaceName!}
          runs={agentDetail.runs}
          cost={agentDetail.cost}
          loading={loading}
          error={error}
        />
      )}
    </div>
  );
}
