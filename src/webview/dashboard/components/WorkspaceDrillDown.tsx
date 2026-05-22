import React from 'react';
import type { FleetAgentSummary, FleetCostSummary, CostTrend } from '../../../types/fleet.js';
import { HealthDot } from './HealthDot.js';
import { CostSummaryBar } from './CostSummaryBar.js';

interface WorkspaceDrillDownProps {
  workspaceName: string;
  agents: FleetAgentSummary[];
  cost: FleetCostSummary;
  loading: boolean;
  error: string | null;
  onSelectAgent: (id: string) => void;
}

const TREND_CHARS: Record<CostTrend, string> = {
  up: '\u2191',
  down: '\u2193',
  flat: '\u2192',
};

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

function handleKeyDown(onSelect: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
}

export function WorkspaceDrillDown({
  workspaceName,
  agents,
  cost,
  loading: _loading,
  error,
  onSelectAgent,
}: WorkspaceDrillDownProps): React.ReactElement {
  return (
    <div>
      <div className="workspace-header">
        <h2 className="workspace-header-title">{workspaceName}</h2>
        <p className="workspace-header-sub">{agents.length} agents</p>
      </div>
      <CostSummaryBar
        label="Workspace Total:"
        totalCostUsd={cost.totalCostUsd}
        totalTokens={cost.totalTokens}
        trend={cost.trend}
      />
      {error ? (
        <div className="fleet-error">
          {error ?? 'Failed to load agents for this workspace. Check the collector status and try refreshing.'}
        </div>
      ) : agents.length === 0 ? (
        <div className="fleet-empty">
          <h2>No agents connected yet</h2>
          <p>Run <code>scripts/install-collector.sh</code> on a machine to see it here.</p>
        </div>
      ) : (
        agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-row"
            role="button"
            tabIndex={0}
            onClick={() => onSelectAgent(agent.id)}
            onKeyDown={handleKeyDown(() => onSelectAgent(agent.id))}
          >
            <div className="agent-row-left">
              <HealthDot health={agent.health} />
              <span className="agent-row-name">{agent.name}</span>
            </div>
            <div className="agent-row-right">
              <span
                className={`agent-row-success ${
                  agent.successRatePct >= 90 ? 'high' : agent.successRatePct >= 50 ? 'mid' : 'low'
                }`}
              >
                {agent.successRatePct}%
              </span>
              <span className="agent-row-lastrun">{formatRelativeTime(agent.lastRunTs)}</span>
              <span className="agent-row-cost">
                ${agent.costUsd.toFixed(2)}{' '}
                <span className={`cost-trend ${agent.costTrend}`}>{TREND_CHARS[agent.costTrend]}</span>
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
