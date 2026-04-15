import React from 'react';
import type { WorkspaceRecord } from '../../../types/workspace';
import { StatusBadge } from './StatusBadge';
import { vscode } from '../vscodeApi';

interface WorkspaceItemProps {
  workspace: WorkspaceRecord;
}

export function WorkspaceItem({ workspace }: WorkspaceItemProps) {
  const handleOpen = () => {
    vscode.postMessage({ type: 'workspace:open', workspaceId: workspace.id });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpen();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    vscode.postMessage({ type: 'workspace:remove', workspaceId: workspace.id });
  };

  return (
    <div
      className="workspace-item"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <StatusBadge status={workspace.status} />
      <div className="workspace-info">
        <div className="workspace-name">{workspace.name}</div>
        <div className="workspace-path">{workspace.rootPath}</div>
      </div>
      <div className="workspace-badges">
        {workspace.runningAgentCount > 0 && (
          <span className="badge badge-running">
            {workspace.runningAgentCount} running
          </span>
        )}
        {workspace.errorCount > 0 && (
          <span className="badge badge-error">
            {workspace.errorCount} error{workspace.errorCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
