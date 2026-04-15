import React from 'react';
import { STATUS_INDICATORS } from '../../../types/status';
import type { WorkspaceStatus } from '../../../types/workspace';

interface StatusBadgeProps {
  status: WorkspaceStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const indicator = STATUS_INDICATORS[status];
  const isOutline = status === 'idle';

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-label={indicator.label}
      style={{ flexShrink: 0 }}
    >
      <title>{indicator.label}</title>
      <path
        d={indicator.svgPath}
        fill={isOutline ? 'none' : indicator.color}
        stroke={isOutline ? indicator.color : 'none'}
        strokeWidth={isOutline ? 2 : 0}
      />
    </svg>
  );
}
