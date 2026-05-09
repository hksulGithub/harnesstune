/** Status indicator shape — paired with color for accessibility (SIDE-02) */
export type StatusShape = 'circle' | 'triangle' | 'square' | 'diamond';

/** Maps workspace status to visual indicator */
export interface StatusIndicator {
  status: import('./workspace').WorkspaceStatus;
  color: string;         // VSCode CSS variable name (e.g., '--vscode-testing-iconPassed')
  shape: StatusShape;
  label: string;         // Accessible text label
  svgPath: string;       // SVG path data for the shape
}

/** Predefined status indicator mappings — color + shape, never color alone */
export const STATUS_INDICATORS: Record<import('./workspace').WorkspaceStatus, StatusIndicator> = {
  running: {
    status: 'running',
    color: 'var(--vscode-testing-iconPassed)',
    shape: 'circle',
    label: 'Running',
    svgPath: 'M12 2a10 10 0 110 20 10 10 0 010-20z',  // filled circle
  },
  idle: {
    status: 'idle',
    color: 'var(--vscode-foreground)',
    shape: 'circle',
    label: 'Idle',
    svgPath: 'M12 4a8 8 0 100 16 8 8 0 000-16z',      // outline circle (stroke only)
  },
  warning: {
    status: 'warning',
    color: 'var(--vscode-editorWarning-foreground)',
    shape: 'triangle',
    label: 'Warning',
    svgPath: 'M12 2L2 22h20L12 2z',                     // triangle
  },
  error: {
    status: 'error',
    color: 'var(--vscode-errorForeground)',
    shape: 'diamond',
    label: 'Error',
    svgPath: 'M12 2l10 10-10 10L2 12 12 2z',            // diamond
  },
  unknown: {
    status: 'unknown',
    color: 'var(--vscode-disabledForeground)',
    shape: 'square',
    label: 'Unknown',
    svgPath: 'M4 4h16v16H4z',                            // square
  },
  stale: {
    status: 'stale',
    color: 'var(--vscode-editorWarning-foreground)',
    shape: 'circle',
    label: 'Stale',
    svgPath: 'M12 4a8 8 0 100 16 8 8 0 000-16z',         // outline circle (stroke only)
  },
  relay_unreachable: {
    status: 'relay_unreachable',
    color: 'var(--vscode-errorForeground)',
    shape: 'triangle',
    label: 'Relay Unreachable',
    svgPath: 'M12 2L2 22h20L12 2z',                      // triangle
  },
  auth_error: {
    status: 'auth_error',
    color: 'var(--vscode-errorForeground)',
    shape: 'diamond',
    label: 'Auth Error',
    svgPath: 'M12 2l10 10-10 10L2 12 12 2z',             // diamond
  },
};

export type AgentStatus = import('./workspace').WorkspaceStatus;
