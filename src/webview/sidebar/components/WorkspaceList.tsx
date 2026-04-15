import React from 'react';
import type { WorkspaceRecord } from '../../../types/workspace';
import { WorkspaceItem } from './WorkspaceItem';

interface WorkspaceListProps {
  workspaces: WorkspaceRecord[];
}

export function WorkspaceList({ workspaces }: WorkspaceListProps) {
  return (
    <div className="workspace-list" role="list">
      {workspaces.map(ws => (
        <WorkspaceItem key={ws.id} workspace={ws} />
      ))}
    </div>
  );
}
