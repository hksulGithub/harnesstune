import React from 'react';
import { WorkspaceSelector } from './WorkspaceSelector';

interface WorkspaceEntry {
  id: string;
  name: string;
}

interface ToolbarProps {
  scale: number;
  onFitToView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  workspaceFilter: string | null;
  workspaces: WorkspaceEntry[];
  onWorkspaceChange: (workspaceId: string | null) => void;
}

export function Toolbar({
  scale,
  onFitToView,
  onZoomIn,
  onZoomOut,
  workspaceFilter,
  workspaces,
  onWorkspaceChange,
}: ToolbarProps): React.ReactElement {
  const zoomPercent = Math.round(scale * 100);

  return (
    <div className="toolbar" role="toolbar" aria-label="Graph controls">
      <div className="toolbar-left">
        <button
          className="toolbar-btn"
          onClick={onFitToView}
          title="Fit graph to view (F)"
          aria-label="Fit graph to view"
        >
          ⊡ Fit
        </button>
        <button
          className="toolbar-btn"
          onClick={onZoomIn}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          +
        </button>
        <span
          className="zoom-readout"
          role="status"
          aria-live="polite"
          aria-label={`Zoom level ${zoomPercent} percent`}
          title="Current zoom level. Scroll to zoom."
        >
          {zoomPercent}%
        </span>
        <button
          className="toolbar-btn"
          onClick={onZoomOut}
          title="Zoom out (−)"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>
      <div className="toolbar-right">
        <WorkspaceSelector
          workspaces={workspaces}
          value={workspaceFilter}
          onChange={onWorkspaceChange}
        />
      </div>
    </div>
  );
}
