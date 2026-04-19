import React, { useState, useEffect, useRef } from 'react';
import type { WorkspaceRecord } from '../../../types/workspace';
import { StatusBadge } from './StatusBadge';
import { vscode } from '../vscodeApi';

interface WorkspaceItemProps {
  workspace: WorkspaceRecord;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function WorkspaceItem({ workspace }: WorkspaceItemProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menuPos) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuPos]);

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
      {menuPos && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button onClick={() => { setMenuPos(null); vscode.postMessage({ type: 'workspace:configure', workspaceId: workspace.id }); }}>
            Configure
          </button>
          <button onClick={() => { setMenuPos(null); vscode.postMessage({ type: 'workspace:remove', workspaceId: workspace.id }); }}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
