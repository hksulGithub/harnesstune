import React from 'react';
import type { AgentSession, AgentEvent } from '../../../types/agent';

interface AgentDetailPanelProps {
  session: AgentSession | null;
  events: AgentEvent[];
  showControls?: boolean;  // default true; set false for read-only contexts (e.g., schematic)
  /** Render prop for control buttons — avoids cross-bundle vscodeApi import */
  renderControls?: (sessionId: string, controlState: string) => React.ReactNode;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AgentDetailPanel({ session, events, showControls = true, renderControls }: AgentDetailPanelProps): React.ReactElement {
  if (!session) {
    return (
      <div className="empty-state">
        <h2>Select an agent to view details</h2>
        <p>Click an agent card on the left to inspect its status, tokens, and recent actions.</p>
      </div>
    );
  }

  // Compute total token usage from events
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  for (const ev of events) {
    if (ev.tokenUsage) {
      totalInput += ev.tokenUsage.inputTokens ?? 0;
      totalOutput += ev.tokenUsage.outputTokens ?? 0;
      totalCacheRead += ev.tokenUsage.cacheReadTokens ?? 0;
    }
  }
  const totalTokens = totalInput + totalOutput;

  // Recent tool use events (last 10)
  const toolEvents = events
    .filter(ev => ev.eventType === 'PreToolUse' || ev.eventType === 'PostToolUse' || ev.eventType === 'PostToolUseFailure')
    .slice(-10)
    .reverse();

  const agentName = session.agentRole ?? session.sessionId.slice(0, 8);

  return (
    <div>
      {/* Header */}
      <div className="detail-header">
        <span
          className={`status-dot ${session.controlState}`}
          aria-label={`${agentName} is ${session.controlState}`}
        />
        <span className="name">{agentName}</span>
        {showControls && renderControls && renderControls(session.sessionId, session.controlState)}
      </div>

      {/* Info grid */}
      <div className="detail-section">
        <h3>Info</h3>
        <div className="info-grid">
          <span className="key">Role</span>
          <span className="value">{session.agentRole ?? '—'}</span>
          <span className="key">Model</span>
          <span className="value">{session.model ?? '—'}</span>
          <span className="key">Session ID</span>
          <span className="value">{session.sessionId}</span>
          <span className="key">PID</span>
          <span className="value">{session.pid ?? '—'}</span>
          <span className="key">Workspace</span>
          <span className="value">{session.workspaceId}</span>
          <span className="key">Started</span>
          <span className="value">{formatTimestamp(session.startedAt)}</span>
        </div>
      </div>

      {/* Token usage */}
      <div className="detail-section">
        <h3>Token Usage</h3>
        <div className="token-bar">
          <span>In: {totalInput.toLocaleString()}</span>
          <div className="bar" title={`${totalTokens} total tokens`} />
          <span>Out: {totalOutput.toLocaleString()}</span>
          {totalCacheRead > 0 && <span>Cache: {totalCacheRead.toLocaleString()}</span>}
        </div>
      </div>

      {/* Recent actions */}
      <div className="detail-section">
        <h3>Recent Actions</h3>
        {toolEvents.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--vscode-descriptionForeground)' }}>No tool actions yet.</p>
        ) : (
          <ul className="action-list">
            {toolEvents.map((ev, i) => (
              <li key={ev.id ?? i}>
                <span>
                  {ev.eventType === 'PostToolUseFailure'
                    ? <span className="codicon codicon-error" aria-label="failed" />
                    : <span className="codicon codicon-check" aria-label="success" />
                  }
                  {' '}{ev.toolName ?? ev.eventType}
                </span>
                <span className="timestamp">{formatTimestamp(ev.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Config excerpt */}
      <div className="detail-section">
        <details className="config-details">
          <summary>Session Config</summary>
          <pre>{JSON.stringify({
            sessionId: session.sessionId,
            workspaceId: session.workspaceId,
            model: session.model,
            agentRole: session.agentRole,
            controlState: session.controlState,
            pid: session.pid,
          }, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}
