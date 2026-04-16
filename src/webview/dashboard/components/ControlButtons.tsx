import React from 'react';
import type { AgentControlState } from '../../../types/agent';
import vscode from '../vscodeApi';

interface ControlButtonsProps {
  sessionId: string;
  controlState: AgentControlState;
  size?: 'small' | 'large';
}

export function ControlButtons({ sessionId, controlState, size = 'small' }: ControlButtonsProps): React.ReactElement | null {
  const iconSize = size === 'large' ? '16px' : '14px';

  const handlePause = (e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'agent:pause', sessionId });
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'agent:resume', sessionId });
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'agent:stop', sessionId });
  };

  if (controlState === 'stopped') {
    return null;
  }

  if (controlState === 'stopping') {
    return (
      <div className="controls">
        <button
          className="control-btn"
          disabled
          aria-label="Stopping agent"
          style={{ fontSize: iconSize }}
        >
          <span className="codicon codicon-loading" />
        </button>
      </div>
    );
  }

  if (controlState === 'running') {
    return (
      <div className="controls">
        <button
          className="control-btn"
          onClick={handlePause}
          aria-label="Pause agent"
          title="Pause agent"
          style={{ fontSize: iconSize }}
        >
          <span className="codicon codicon-debug-pause" />
        </button>
        <button
          className="control-btn destructive"
          onClick={handleStop}
          aria-label="Stop agent"
          title="Stop agent"
          style={{ fontSize: iconSize }}
        >
          <span className="codicon codicon-debug-stop" />
        </button>
      </div>
    );
  }

  if (controlState === 'paused') {
    return (
      <div className="controls">
        <button
          className="control-btn"
          onClick={handleResume}
          aria-label="Resume agent"
          title="Resume agent"
          style={{ fontSize: iconSize }}
        >
          <span className="codicon codicon-debug-continue" />
        </button>
        <button
          className="control-btn destructive"
          onClick={handleStop}
          aria-label="Stop agent"
          title="Stop agent"
          style={{ fontSize: iconSize }}
        >
          <span className="codicon codicon-debug-stop" />
        </button>
      </div>
    );
  }

  return null;
}
