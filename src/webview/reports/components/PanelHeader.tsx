import React from 'react';

interface PanelHeaderProps {
  workspaceName: string;
  connectionStatus: 'connected' | 'stale' | 'error';
}

const statusLabels: Record<string, string> = {
  connected: 'Connected',
  stale: 'Stale',
  error: 'Error',
};

export default function PanelHeader({ workspaceName, connectionStatus }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <span className="panel-header__name">{workspaceName}</span>
      <span className={`panel-header__status panel-header__status--${connectionStatus}`}>
        {statusLabels[connectionStatus]}
      </span>
    </div>
  );
}
