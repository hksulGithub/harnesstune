import React from 'react';
import type { TopologyNode } from '../../../types/topology';
import type { AgentControlState } from '../../../types/agent';

interface MinimapProps {
  nodes: TopologyNode[];
  viewTransform: { x: number; y: number; scale: number };
  svgWidth: number;
  svgHeight: number;
}

const MINIMAP_W = 120;
const MINIMAP_H = 80;
const NODE_W = 140;
const NODE_H = 44;
const PADDING = 24;

function nodeStatusColor(status: AgentControlState): string {
  switch (status) {
    case 'running':  return 'var(--vscode-terminal-ansiGreen)';
    case 'paused':   return 'var(--vscode-terminal-ansiYellow)';
    case 'stopped':  return 'var(--vscode-descriptionForeground)';
    case 'stopping': return 'var(--vscode-descriptionForeground)';
    default:         return 'var(--vscode-errorForeground)';
  }
}

export function Minimap({
  nodes,
  viewTransform,
  svgWidth,
  svgHeight,
}: MinimapProps): React.ReactElement | null {
  if (nodes.length <= 5) return null;

  // Compute full graph bounding box
  if (nodes.length === 0) return null;

  const minX = Math.min(...nodes.map(n => n.x)) - PADDING;
  const minY = Math.min(...nodes.map(n => n.y)) - PADDING;
  const maxX = Math.max(...nodes.map(n => n.x + NODE_W)) + PADDING;
  const maxY = Math.max(...nodes.map(n => n.y + NODE_H)) + PADDING;

  const graphW = maxX - minX;
  const graphH = maxY - minY;

  if (graphW <= 0 || graphH <= 0) return null;

  const scaleX = MINIMAP_W / graphW;
  const scaleY = MINIMAP_H / graphH;

  // Viewport indicator: visible area in world space
  // At viewTransform { x, y, scale }, the visible world area is:
  //   x range: (-viewTransform.x / scale) to (-viewTransform.x / scale + svgWidth / scale)
  //   y range: (-viewTransform.y / scale) to (-viewTransform.y / scale + svgHeight / scale)
  const visWorldX = -viewTransform.x / viewTransform.scale;
  const visWorldY = -viewTransform.y / viewTransform.scale;
  const visWorldW = svgWidth / viewTransform.scale;
  const visWorldH = svgHeight / viewTransform.scale;

  const vpX = (visWorldX - minX) * scaleX;
  const vpY = (visWorldY - minY) * scaleY;
  const vpW = visWorldW * scaleX;
  const vpH = visWorldH * scaleY;

  return (
    <div className="minimap" role="img" aria-label={`Graph minimap, showing ${nodes.length} agents`}>
      <svg width={MINIMAP_W} height={MINIMAP_H} overflow="hidden">
        {/* Node rects */}
        {nodes.map(node => (
          <rect
            key={node.sessionId}
            x={(node.x - minX) * scaleX}
            y={(node.y - minY) * scaleY}
            width={Math.max(1, NODE_W * scaleX)}
            height={Math.max(1, NODE_H * scaleY)}
            fill={nodeStatusColor(node.status)}
            opacity={node.opacity}
          />
        ))}

        {/* Viewport indicator */}
        <rect
          x={vpX}
          y={vpY}
          width={Math.min(vpW, MINIMAP_W)}
          height={Math.min(vpH, MINIMAP_H)}
          fill="var(--vscode-foreground)"
          fillOpacity={0.1}
          stroke="var(--vscode-focusBorder)"
          strokeWidth="1"
        >
          <title>Visible area</title>
        </rect>
      </svg>
    </div>
  );
}
