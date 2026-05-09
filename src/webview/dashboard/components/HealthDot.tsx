import React from 'react';
import type { HealthState } from '../../../types/fleet.js';

interface HealthDotProps {
  health: HealthState;
  showLabel?: boolean;
}

const HEALTH_LABELS: Record<HealthState, string> = {
  'healthy': 'Healthy',
  'degraded': 'Degraded',
  'failing': 'Failing',
  'no-data': 'No Data',
};

export function HealthDot({ health, showLabel = false }: HealthDotProps): React.ReactElement {
  return (
    <span className="status-label">
      <span className={`health-dot ${health}`} aria-label={HEALTH_LABELS[health]} />
      {showLabel && <span>{HEALTH_LABELS[health]}</span>}
    </span>
  );
}
