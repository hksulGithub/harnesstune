import React from 'react';

interface RunLogExpanderProps {
  logText: string;
  expanded: boolean;
  onToggle: () => void;
}

export function RunLogExpander({ expanded, onToggle }: RunLogExpanderProps): React.ReactElement {
  return (
    <button
      className="expand-toggle"
      aria-label={expanded ? 'Collapse log' : 'Expand log'}
      onClick={onToggle}
    >
      {expanded ? '\u2212' : '+'}
    </button>
  );
}

export function RunLogSection({ logText }: { logText: string }): React.ReactElement {
  return (
    <div className="run-log-section">
      <pre className="run-log-text">{logText}</pre>
    </div>
  );
}
