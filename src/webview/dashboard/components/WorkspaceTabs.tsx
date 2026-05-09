import React from 'react';

interface WorkspaceTab {
  id: string;
  name: string;
  agentCount: number;
}

interface WorkspaceTabsProps {
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string | null) => void;
}

export function WorkspaceTabs({ workspaces, activeWorkspaceId, onSelectWorkspace }: WorkspaceTabsProps): React.ReactElement {
  // Only show tabs when there are multiple workspaces with sessions
  if (workspaces.length <= 1) {
    return <></>;
  }
  return (
    <div className="tab-bar" role="tablist" aria-label="Workspaces">
      {workspaces.map(ws => (
        <button
          key={ws.id}
          className={`tab${activeWorkspaceId === ws.id ? ' active' : ''}`}
          role="tab"
          aria-selected={activeWorkspaceId === ws.id}
          onClick={() => onSelectWorkspace(ws.id)}
        >
          {ws.name}
          <span className="badge">{ws.agentCount}</span>
        </button>
      ))}
    </div>
  );
}
