import React, { useState } from 'react';
import type { FleetRunRecord, FleetCostSummary } from '../../../types/fleet.js';
import { HealthDot } from './HealthDot.js';
import { CostSummaryBar } from './CostSummaryBar.js';
import { RunLogExpander, RunLogSection } from './RunLogExpander.js';

interface AgentDetailProps {
  agentName: string;
  workspaceName: string;
  runs: FleetRunRecord[];
  cost: FleetCostSummary;
  loading: boolean;
  error: string | null;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function AgentDetail({
  agentName,
  workspaceName,
  runs,
  cost,
  loading: _loading,
  error,
}: AgentDetailProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(runId: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  return (
    <div>
      <div className="agent-detail-header">
        <h2 className="agent-detail-title">{agentName}</h2>
        <p className="agent-detail-sub">in {workspaceName}</p>
      </div>
      <CostSummaryBar
        label="Agent Total:"
        totalCostUsd={cost.totalCostUsd}
        totalTokens={cost.totalTokens}
        trend={cost.trend}
      />
      {error ? (
        <div className="fleet-error">
          {error ?? 'Failed to load run history for this agent. Check the collector status and try refreshing.'}
        </div>
      ) : runs.length === 0 ? (
        <div className="fleet-empty">
          <h2>No runs recorded</h2>
          <p>Agent runs will appear here once the collector reports data.</p>
        </div>
      ) : (
        <div className="run-table">
          <div className="run-table-header">
            <div className="run-table-header-cell col-timestamp">Timestamp</div>
            <div className="run-table-header-cell col-duration">Duration</div>
            <div className="run-table-header-cell col-status">Status</div>
            <div className="run-table-header-cell col-cost">Cost</div>
            <div className="run-table-header-cell col-expand"></div>
          </div>
          {runs.map((run) => {
            const isExpanded = expandedIds.has(run.runId);
            return (
              <React.Fragment key={run.runId}>
                <div className="run-row" tabIndex={0}>
                  <div className="run-cell col-timestamp">{formatTimestamp(run.timestampTs)}</div>
                  <div className="run-cell col-duration">{formatDuration(run.durationMs)}</div>
                  <div className="run-cell col-status">
                    <HealthDot health={run.status} showLabel={true} />
                  </div>
                  <div className="run-cell col-cost">${run.costUsd.toFixed(2)}</div>
                  <div className="run-cell col-expand">
                    <RunLogExpander
                      logText={run.logText}
                      expanded={isExpanded}
                      onToggle={() => toggleExpand(run.runId)}
                    />
                  </div>
                </div>
                {isExpanded && <RunLogSection logText={run.logText} />}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
