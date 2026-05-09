import React from 'react';
import type { AnalyticsWindowStats } from '../../../types/fleet.js';

interface AnalyticsPanelProps {
  title: string;
  windows: AnalyticsWindowStats[];
}

function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function AnalyticsPanel({ title, windows }: AnalyticsPanelProps): React.ReactElement {
  return (
    <section className="analytics-panel">
      <div className="analytics-panel__header">
        <h3>{title}</h3>
      </div>
      <div className="analytics-panel__grid">
        {windows.map((item) => (
          <div key={item.label} className="analytics-panel__card">
            <div className="analytics-panel__label">{item.label}</div>
            <div className="analytics-panel__metric">{item.runCount} runs</div>
            <div className="analytics-panel__submetric">Avg {formatDuration(item.averageDurationMs)}</div>
            <div className="analytics-panel__submetric">{item.successRatePct}% success</div>
          </div>
        ))}
      </div>
    </section>
  );
}
