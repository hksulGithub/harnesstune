import React from 'react';
import type { FleetWorkspaceSummary } from '../../../types/fleet.js';
import { HealthDot } from './HealthDot.js';

interface FleetOverviewProps {
  summaries: FleetWorkspaceSummary[];
  loading: boolean;
  error: string | null;
  onSelectWorkspace: (id: string) => void;
}

function formatRelativeTime(ts: number): string {
  if (ts === 0) {
    return 'Never';
  }
  const diff = Date.now() - ts;
  if (diff < 60000) {
    return 'Just now';
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatWorkspaceStatus(ws: FleetWorkspaceSummary): string {
  if (ws.health === 'unreachable') {
    return 'Relay unreachable';
  }
  return formatRelativeTime(ws.lastActivityTs);
}

function formatRelayBadge(ws: FleetWorkspaceSummary): string | null {
  if (!ws.relayStatus) {
    return null;
  }
  if (ws.relayStatus === 'unreachable') {
    return 'Relay unreachable';
  }
  if (ws.relayStatus === 'no-data') {
    return 'Relay no data';
  }
  return `Relay ${ws.relayStatus}`;
}

function handleKeyDown(onSelect: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
}

export function FleetOverview({ summaries, loading: _loading, error, onSelectWorkspace }: FleetOverviewProps): React.ReactElement {
  if (error) {
    return <div className="fleet-error">{error}</div>;
  }

  return (
    <div>
      <div className="fleet-header">
        <h2 className="fleet-header-title">Agent Fleet</h2>
        <p className="fleet-header-sub">{summaries.length} workspaces</p>
      </div>
      {summaries.length === 0 ? (
        <div className="fleet-empty">
          <h2>No workspaces connected</h2>
          <p>Add a workspace to start monitoring your agent fleet.</p>
        </div>
      ) : (
        summaries.map((ws) => (
          <div
            key={ws.id}
            className="workspace-card"
            role="button"
            tabIndex={0}
            onClick={() => onSelectWorkspace(ws.id)}
            onKeyDown={handleKeyDown(() => onSelectWorkspace(ws.id))}
          >
            <div className="workspace-card-top">
              <div className="workspace-card-left">
                <HealthDot health={ws.health} />
                <span className="workspace-card-name">{ws.name}</span>
              </div>
              <div className="workspace-card-right">
                {formatRelayBadge(ws) && (
                  <span className={`workspace-card-relay-badge ${ws.relayStatus}`}>{formatRelayBadge(ws)}</span>
                )}
                <span className="workspace-card-platform">{ws.platform}</span>
              </div>
            </div>
            <div className="workspace-card-metrics">
              <span>
                <span className="metric-value">{ws.agentCount}</span>
                <span className="metric-label"> agents</span>
              </span>
              <span>
                <span className={ws.errorRatePct > 0 ? 'metric-value metric-error' : 'metric-value'}>
                  {ws.errorRatePct}%
                </span>
                <span className="metric-label"> error rate</span>
              </span>
              <span>
                <span className={ws.health === 'unreachable' ? 'metric-label metric-error' : 'metric-label'}>
                  {formatWorkspaceStatus(ws)}
                </span>
              </span>
            </div>
            <div className="workspace-card-cta">View agents →</div>
          </div>
        ))
      )}
    </div>
  );
}
