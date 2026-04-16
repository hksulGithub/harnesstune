import React from 'react';
import type { AgentSession, AgentEvent } from '../../../types/agent';
import { ControlButtons } from './ControlButtons';

interface AgentCardProps {
  session: AgentSession;
  recentEvent?: AgentEvent;
  isSelected: boolean;
  onSelect: (sessionId: string) => void;
}

export function AgentCard({ session, isSelected, onSelect }: AgentCardProps): React.ReactElement {
  const { sessionId, controlState, agentRole } = session;
  const agentName = session.agentRole ?? sessionId.slice(0, 8);

  const handleClick = () => {
    onSelect(sessionId);
  };

  return (
    <button
      className={`agent-card${isSelected ? ' selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      aria-label={`Agent ${agentName}`}
      onClick={handleClick}
    >
      <span
        className={`status-dot ${controlState}`}
        aria-label={`${agentName} is ${controlState}`}
      />
      <div className="info">
        <div className="name">{agentName}</div>
        {agentRole && <div className="role">{agentRole}</div>}
      </div>
      <ControlButtons sessionId={sessionId} controlState={controlState} size="small" />
    </button>
  );
}
