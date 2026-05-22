import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentDetail } from '../../src/webview/dashboard/components/AgentDetail';
import { DateRangeSelector } from '../../src/webview/dashboard/components/DateRangeSelector';
import { FleetOverview } from '../../src/webview/dashboard/components/FleetOverview';
import { WorkspaceDrillDown } from '../../src/webview/dashboard/components/WorkspaceDrillDown';
import type { FleetRunRecord, FleetWorkspaceSummary } from '../../src/types/fleet';

describe('dashboard fleet components', () => {
  it('renders reachable and unreachable workspaces distinctly', () => {
    const summaries: FleetWorkspaceSummary[] = [
      {
        id: 'local',
        name: 'Local Claude Code',
        platform: 'claude-code',
        health: 'healthy',
        agentCount: 2,
        errorRatePct: 0,
        lastActivityTs: Date.now(),
      },
      {
        id: 'remote',
        name: 'Remote Relay',
        platform: 'relay',
        health: 'unreachable',
        agentCount: 0,
        errorRatePct: 0,
        lastActivityTs: 0,
      },
    ];

    const html = renderToStaticMarkup(
      <FleetOverview summaries={summaries} loading={false} error={null} onSelectWorkspace={jest.fn()} />
    );

    expect(html).toContain('Local Claude Code');
    expect(html).toContain('Remote Relay');
    expect(html).toContain('Relay unreachable');
    expect(html).toContain('health-dot unreachable');
  });

  it('renders empty workspace drill-down state without crashing', () => {
    const html = renderToStaticMarkup(
      <WorkspaceDrillDown
        workspaceName="Empty Workspace"
        agents={[]}
        cost={{ totalCostUsd: 0, totalTokens: 0, trend: 'flat' }}
        loading={false}
        error={null}
        onSelectAgent={jest.fn()}
      />
    );

    expect(html).toContain('Empty Workspace');
    expect(html).toContain('No agents connected yet');
    expect(html).toContain('scripts/install-collector.sh');
  });

  it('renders selected date range and keeps other ranges available', () => {
    const html = renderToStaticMarkup(<DateRangeSelector selected={30} onSelect={jest.fn()} />);

    expect(html).toContain('24h');
    expect(html).toContain('7d');
    expect(html).toContain('30d');
    expect(html).toContain('date-range-tab active');
    expect(html).toContain('aria-selected="true"');
  });

  it('renders agent run history rows with expandable log controls', () => {
    const runs: FleetRunRecord[] = [
      {
        runId: 'run-2',
        timestampTs: Date.UTC(2026, 4, 10, 12, 0),
        durationMs: 125000,
        status: 'failing',
        costUsd: 0.12,
        logText: 'stack trace excerpt',
      },
      {
        runId: 'run-1',
        timestampTs: Date.UTC(2026, 4, 10, 11, 0),
        durationMs: 5000,
        status: 'healthy',
        costUsd: 0.03,
        logText: 'normal output',
      },
    ];

    const html = renderToStaticMarkup(
      <AgentDetail
        agentName="Cron Agent"
        workspaceName="Remote Relay"
        runs={runs}
        cost={{ totalCostUsd: 0.15, totalTokens: 1234, trend: 'flat' }}
        loading={false}
        error={null}
      />
    );

    expect(html).toContain('Cron Agent');
    expect(html).toContain('Timestamp');
    expect(html).toContain('$0.12');
    expect(html).toContain('aria-label="Expand log"');
  });
});
