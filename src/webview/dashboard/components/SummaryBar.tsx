import React from 'react';

interface SummaryBarProps {
  totalAgents: number;
  running: number;
  paused: number;
  errors: number;
}

export function SummaryBar({ totalAgents, running, paused, errors }: SummaryBarProps): React.ReactElement {
  return (
    <div className="summary-bar" aria-label="Agent summary">
      <div className="summary-metric">
        <span className="codicon codicon-organization" aria-hidden="true" />
        <span className="value">{totalAgents}</span>
        <span className="label">Total</span>
      </div>
      <div className="summary-metric">
        <span className="codicon codicon-pulse" aria-hidden="true" />
        <span className="value">{running}</span>
        <span className="label">Running</span>
      </div>
      <div className="summary-metric">
        <span className="codicon codicon-debug-pause" aria-hidden="true" />
        <span className="value">{paused}</span>
        <span className="label">Paused</span>
      </div>
      <div className="summary-metric">
        <span className="codicon codicon-error" aria-hidden="true" />
        <span className="value">{errors}</span>
        <span className="label">Errors</span>
      </div>
    </div>
  );
}
