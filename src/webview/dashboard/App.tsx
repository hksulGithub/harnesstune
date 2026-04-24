import React, { useEffect, useState } from 'react';
import type { FleetWorkspaceSummary, FleetWorkspaceDetail, FleetAgentDetail } from '../../types/fleet.js';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../types/messages.js';
import vscode from './vscodeApi.js';
import { DateRangeSelector } from './components/DateRangeSelector.js';
import { BreadcrumbBar } from './components/BreadcrumbBar.js';
import { FleetOverview } from './components/FleetOverview.js';
import { WorkspaceDrillDown } from './components/WorkspaceDrillDown.js';
import { AgentDetail } from './components/AgentDetail.js';

type ViewLevel = 'fleet' | 'workspace' | 'agent';

interface NavigationState {
  level: ViewLevel;
  workspaceId?: string;
  workspaceName?: string;
  agentId?: string;
  agentName?: string;
}

interface PersistedState {
  nav: NavigationState;
  days: number;
}

function restoreState(): PersistedState {
  const saved = vscode.getState() as PersistedState | null;
  return {
    nav: saved?.nav ?? { level: 'fleet' },
    days: saved?.days ?? 7,
  };
}

export default function App(): React.ReactElement {
  const initial = restoreState();

  const [nav, setNav] = useState<NavigationState>(initial.nav);
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

    if (nav.level === 'fleet') {
      const msg: WebviewToHostMessage = { type: 'fleet:requestOverview', days };
      vscode.postMessage(msg);
    } else if (nav.level === 'workspace' && nav.workspaceId !== undefined) {
      const msg: WebviewToHostMessage = {
        type: 'fleet:requestWorkspaceDetail',
        workspaceId: nav.workspaceId,
        days,
      };
      vscode.postMessage(msg);
    } else if (nav.level === 'agent' && nav.workspaceId !== undefined && nav.agentId !== undefined) {
      const msg: WebviewToHostMessage = {
        type: 'fleet:requestAgentDetail',
        workspaceId: nav.workspaceId,
        agentId: nav.agentId,
        days,
      };
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
    const ws = summaries.find((s) => s.id === id);
    const workspaceName = ws?.name ?? id;
    setNav({ level: 'workspace', workspaceId: id, workspaceName });
  }

  function handleSelectAgent(id: string): void {
    const agent = workspaceDetail?.agents.find((a) => a.id === id);
    const agentName = agent?.name ?? id;
    setNav({
      level: 'agent',
      workspaceId: nav.workspaceId,
      workspaceName: nav.workspaceName,
      agentId: id,
      agentName,
    });
  }

  function handleNavigateFleet(): void {
    setNav({ level: 'fleet' });
  }

  function handleNavigateWorkspace(): void {
    setNav({ level: 'workspace', workspaceId: nav.workspaceId, workspaceName: nav.workspaceName });
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
