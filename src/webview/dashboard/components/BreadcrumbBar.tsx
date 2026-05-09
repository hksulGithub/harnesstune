import React from 'react';

interface BreadcrumbBarProps {
  workspaceName?: string;
  agentName?: string;
  onNavigateFleet: () => void;
  onNavigateWorkspace: () => void;
}

export function BreadcrumbBar({
  workspaceName,
  agentName,
  onNavigateFleet,
  onNavigateWorkspace,
}: BreadcrumbBarProps): React.ReactElement | null {
  if (workspaceName === undefined && agentName === undefined) {
    return null;
  }

  if (workspaceName !== undefined && agentName === undefined) {
    // Depth 1: Fleet > WorkspaceName
    return (
      <nav className="breadcrumb-bar" aria-label="Breadcrumb">
        <button className="breadcrumb-ancestor" onClick={onNavigateFleet}>
          Fleet
        </button>
        <span className="breadcrumb-separator"> &gt; </span>
        <span className="breadcrumb-current">{workspaceName}</span>
      </nav>
    );
  }

  // Depth 2: Fleet > WorkspaceName > AgentName
  return (
    <nav className="breadcrumb-bar" aria-label="Breadcrumb">
      <button className="breadcrumb-ancestor" onClick={onNavigateFleet}>
        Fleet
      </button>
      <span className="breadcrumb-separator"> &gt; </span>
      <button className="breadcrumb-ancestor" onClick={onNavigateWorkspace}>
        {workspaceName}
      </button>
      <span className="breadcrumb-separator"> &gt; </span>
      <span className="breadcrumb-current">{agentName}</span>
    </nav>
  );
}
