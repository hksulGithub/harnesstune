import React from 'react';
import type { CostTrend } from '../../../types/fleet.js';

interface CostSummaryBarProps {
  label: string;
  totalCostUsd: number;
  totalTokens: number;
  trend: CostTrend;
}

const TREND_CHARS: Record<CostTrend, string> = {
  up: '\u2191',
  down: '\u2193',
  flat: '\u2192',
};

function formatCost(totalCostUsd: number): string {
  if (totalCostUsd >= 1000) {
    return '$' + totalCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return `$${totalCostUsd.toFixed(2)}`;
}

export function CostSummaryBar({ label, totalCostUsd, totalTokens, trend }: CostSummaryBarProps): React.ReactElement {
  return (
    <div className="cost-summary-bar">
      <span className="cost-label">{label}</span>
      <span className="cost-value">{formatCost(totalCostUsd)}</span>
      <span className={`cost-trend ${trend}`}>{TREND_CHARS[trend]}</span>
      <span className="cost-tokens">({totalTokens} tokens)</span>
    </div>
  );
}
