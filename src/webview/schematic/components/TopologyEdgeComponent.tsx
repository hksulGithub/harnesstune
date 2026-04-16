import React from 'react';
import type { TopologyEdge, TopologyNode } from '../../../types/topology';
import type { AgentControlState } from '../../../types/agent';

interface TopologyEdgeComponentProps {
  edge: TopologyEdge;
  sourceNode: TopologyNode;
  targetNode: TopologyNode;
  reducedMotion: boolean;
}

function edgeColor(status: AgentControlState): string {
  switch (status) {
    case 'running':  return 'var(--vscode-terminal-ansiGreen)';
    case 'paused':   return 'var(--vscode-terminal-ansiYellow)';
    case 'stopped':  return 'var(--vscode-descriptionForeground)';
    case 'stopping': return 'var(--vscode-descriptionForeground)';
    default:         return 'var(--vscode-errorForeground)';
  }
}

export function TopologyEdgeComponent({
  edge,
  sourceNode,
  targetNode,
  reducedMotion,
}: TopologyEdgeComponentProps): React.ReactElement {
  const color = edgeColor(edge.status);
  const isDashed = edge.status === 'stopped' || edge.status === 'stopping';

  // Source = bottom-center of source node (140px wide, 44px tall)
  const sx = sourceNode.x + 70;
  const sy = sourceNode.y + 44;

  // Target = top-center of target node
  const tx = targetNode.x + 70;
  const ty = targetNode.y;

  // Cubic bezier with 60px vertical offset control points
  const pathD = `M ${sx} ${sy} C ${sx} ${sy + 60}, ${tx} ${ty - 60}, ${tx} ${ty}`;
  const edgeId = `edge-${edge.id.replace(/[^a-zA-Z0-9-]/g, '_')}`;

  // Determine dot behavior:
  // - edge.isActive && !reducedMotion && edge.status === 'running': traveling dot animation
  // - edge.isActive && reducedMotion: static dot at midpoint
  // - edge.status === 'paused': static dot at midpoint (frozen)
  // - else: no dot
  const showTravelingDot = edge.isActive && !reducedMotion && edge.status === 'running';
  const showStaticDot =
    (edge.isActive && reducedMotion) ||
    edge.status === 'paused';

  // Static dot midpoint (approx cubic bezier midpoint t=0.5)
  const midX = 0.125 * sx + 0.375 * sx + 0.375 * tx + 0.125 * tx;
  const midY = 0.125 * sy + 0.375 * (sy + 60) + 0.375 * (ty - 60) + 0.125 * ty;

  return (
    <g role="presentation" aria-hidden="true">
      <path
        id={edgeId}
        d={pathD}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray={isDashed ? '4 3' : undefined}
      />

      {showTravelingDot && (
        <circle r="3" fill={color} aria-hidden="true">
          <animateMotion dur="1.5s" repeatCount="indefinite">
            {/* eslint-disable-next-line react/no-unknown-property */}
            <mpath xlinkHref={`#${edgeId}`} />
          </animateMotion>
        </circle>
      )}

      {showStaticDot && (
        <circle
          r="3"
          fill={color}
          cx={midX}
          cy={midY}
          aria-hidden="true"
        />
      )}
    </g>
  );
}
