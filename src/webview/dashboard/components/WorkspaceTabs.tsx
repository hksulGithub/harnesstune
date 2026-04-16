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
  return (
    <div className="tab-bar" role="tablist" aria-label="Workspaces">
      {/* "All Workspaces" tab is always first */}
      <button
        className={`tab${activeWorkspaceId === null ? ' active' : ''}`}
        role="tab"
        aria-selected={activeWorkspaceId === null}
        onClick={() => onSelectWorkspace(null)}
      >
        All Workspaces
      </button>
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
