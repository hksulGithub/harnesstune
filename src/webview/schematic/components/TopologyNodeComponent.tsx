import React from 'react';
import type { TopologyNode } from '../../../types/topology';
import type { AgentControlState } from '../../../types/agent';

interface TopologyNodeComponentProps {
  node: TopologyNode;
  isSelected: boolean;
  onClick: (sessionId: string) => void;
  onKeyDown: (e: React.KeyboardEvent<SVGGElement>, sessionId: string) => void;
}

function statusColor(status: AgentControlState): string {
  switch (status) {
    case 'running':  return 'var(--vscode-terminal-ansiGreen)';
    case 'paused':   return 'var(--vscode-terminal-ansiYellow)';
    case 'stopped':  return 'var(--vscode-descriptionForeground)';
    case 'stopping': return 'var(--vscode-descriptionForeground)';
    default:         return 'var(--vscode-errorForeground)';
  }
}

function statusChipText(status: AgentControlState): string {
  switch (status) {
    case 'running':  return 'RUNNING';
    case 'paused':   return 'PAUSED';
    case 'stopped':  return 'DONE';
    case 'stopping': return 'DONE';
    default:         return 'ERROR';
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

export function TopologyNodeComponent({
  node,
  isSelected,
  onClick,
  onKeyDown,
}: TopologyNodeComponentProps): React.ReactElement {
  const color = statusColor(node.status);
  const chipText = statusChipText(node.status);
  const isDashed = node.status === 'stopped' || node.status === 'stopping';
  const isError = (node.status as string) === 'error';
  const agentName = truncate(node.agentRole ?? 'Agent', 18);
  const sessionShort = node.sessionId.slice(0, 8);

  // Accessible label
  const completedSuffix = isDashed ? ', completed' : '';
  const ariaLabel = `${node.agentRole ?? 'Agent'}, ${node.status}, session ${sessionShort}, click to inspect${completedSuffix}`;

  const rectFill = isSelected
    ? 'var(--vscode-list-activeSelectionBackground)'
    : 'var(--vscode-editor-background)';
  const textFill = isSelected
    ? 'var(--vscode-list-activeSelectionForeground)'
    : 'var(--vscode-foreground)';

  return (
    <g
      className={`node${isSelected ? ' selected' : ''}`}
      data-session-id={node.sessionId}
      transform={`translate(${node.x}, ${node.y})`}
      opacity={node.opacity}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      onClick={() => onClick(node.sessionId)}
      onKeyDown={e => onKeyDown(e, node.sessionId)}
    >
      {/* Error outer ring */}
      {isError && (
        <rect
          x="-3"
          y="-3"
          width="146"
          height="50"
          rx="8"
          fill="none"
          stroke="var(--vscode-errorForeground)"
          strokeWidth="1"
        />
      )}

      {/* Main node rect */}
      <rect
        width="140"
        height="44"
        rx="6"
        fill={rectFill}
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={isDashed ? '4 3' : undefined}
      />

      {/* Status dot */}
      <circle cx="16" cy="22" r="4" fill={color} />

      {/* Primary label: agent name */}
      <text
        x="28"
        y="18"
        fontSize="13"
        fontWeight="600"
        fill={textFill}
        style={{ userSelect: 'none' }}
      >
        {agentName}
      </text>

      {/* Secondary label: session ID */}
      <text
        x="28"
        y="34"
        fontSize="11"
        fill="var(--vscode-descriptionForeground)"
        style={{ userSelect: 'none' }}
      >
        sess:{sessionShort}
      </text>

      {/* Status chip background */}
      <rect
        className="status-chip"
        x="88"
        y="28"
        width="44"
        height="12"
        rx="6"
        fill="var(--vscode-badge-background)"
      />

      {/* Status chip text */}
      <text
        x="110"
        y="38"
        fontSize="11"
        fontWeight="600"
        textAnchor="middle"
        fill="var(--vscode-badge-foreground)"
        style={{ userSelect: 'none' }}
      >
        {chipText}
      </text>

      {/* Focus ring (rendered via CSS :focus-visible on the <g>) */}
    </g>
  );
}
