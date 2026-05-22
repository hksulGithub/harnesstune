import { formatAlertWarningMessage } from '../../src/alerts/alertNotifications';
import type { AlertCycleSummary, AlertTransition } from '../../src/types/alerts';

function transition(currentState: AlertTransition['currentState']): AlertTransition {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Workspace 1',
    agentId: `agent-${currentState}`,
    agentName: `Agent ${currentState}`,
    previousState: 'healthy',
    currentState,
    lastRunAt: null,
    reason: '',
  };
}

describe('formatAlertWarningMessage', () => {
  it('returns null when there are no problem transitions', () => {
    const summary: AlertCycleSummary = {
      problems: [],
      recoveries: [transition('healthy')],
    };

    expect(formatAlertWarningMessage(summary)).toBeNull();
  });

  it('formats singular alert copy', () => {
    const summary: AlertCycleSummary = {
      problems: [transition('failing')],
      recoveries: [],
    };

    expect(formatAlertWarningMessage(summary)).toBe('1 agent needs attention: 1 failing');
  });

  it('batches failing, stale, and degraded alerts into one message', () => {
    const summary: AlertCycleSummary = {
      problems: [
        transition('failing'),
        transition('failing'),
        transition('stale'),
        transition('degraded'),
      ],
      recoveries: [],
    };

    expect(formatAlertWarningMessage(summary)).toBe(
      '4 agents need attention: 2 failing, 1 stale, 1 degraded'
    );
  });
});
