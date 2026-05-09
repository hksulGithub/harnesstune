---
phase: 10
plan: 2
title: "React Components + CSS + Integration"
wave: 2
depends_on: [1]
estimated_tasks: 2
objective: "Build all 10 React components from the UI-SPEC (PanelHeader, FilterTabs, TimelineFeed, BriefingReportCard, RalphLoopReportCard, RalphLoopChart, ChatBubble, MessageComposer, LoadMoreButton, EmptyState), complete reports.css styling, and wire the full component tree into App.tsx."
---

# Plan 02 — React Components + CSS + Integration

## Task 1: React Components

<read_first>
- src/webview/reports/App.tsx (shell from Plan 01 — replace placeholder with full component tree)
- src/webview/reports/styles/reports.css (minimal reset from Plan 01 — extend with full styling)
- .planning/phases/10-report-timeline-ui-async-chat/10-UI-SPEC.md (component specs 1-11)
- .planning/phases/10-report-timeline-ui-async-chat/10-CONTEXT.md (D-01 through D-10)
- packages/shared/src/reports.ts (BriefingReportBody, RalphReportBody, ReportEnvelope, TimelineItem, RelayMessage)
- src/webview/chat/components/ (chat.css patterns for bubble styling, fade-in animation)
- src/webview/dashboard/components/ (dashboard component patterns for reference)
</read_first>

<action>

### 1a. Create utility: src/webview/reports/utils.ts

Relative timestamp formatter + delta color helper:

```typescript
/** Relative timestamp per UI-SPEC copywriting contract */
export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  // Absolute: "MMM D, h:mm a"
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${hours}:${min} ${ampm}`;
}

/** CSS class for delta value color */
export function deltaClass(value: number): string {
  if (value > 0) return 'delta-positive';
  if (value < 0) return 'delta-negative';
  return 'delta-zero';
}

/** Format delta with + prefix for positive values */
export function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
```

### 1b. Create src/webview/reports/components/PanelHeader.tsx

```typescript
import React from 'react';

interface PanelHeaderProps {
  workspaceName: string;
  connectionStatus: 'connected' | 'stale' | 'error';
}

const statusLabels: Record<string, string> = {
  connected: 'Connected',
  stale: 'Stale',
  error: 'Error',
};

export default function PanelHeader({ workspaceName, connectionStatus }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <span className="panel-header__name">{workspaceName}</span>
      <span className={`panel-header__status panel-header__status--${connectionStatus}`}>
        {statusLabels[connectionStatus]}
      </span>
    </div>
  );
}
```

### 1c. Create src/webview/reports/components/FilterTabs.tsx

```typescript
import React from 'react';
import type { TimelineItem } from '@harnesstune/shared';

export type FilterTab = 'all' | 'briefings' | 'ralph' | 'chat';

interface FilterTabsProps {
  active: FilterTab;
  onSelect: (tab: FilterTab) => void;
  items: TimelineItem[];
}

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'briefings', label: 'Briefings' },
  { key: 'ralph', label: 'Ralph' },
  { key: 'chat', label: 'Chat' },
];

function countForTab(tab: FilterTab, items: TimelineItem[]): number {
  if (tab === 'all') return items.length;
  if (tab === 'briefings') return items.filter(i => i.kind === 'report' && i.data.type === 'briefing').length;
  if (tab === 'ralph') return items.filter(i => i.kind === 'report' && i.data.type === 'ralph').length;
  if (tab === 'chat') return items.filter(i => i.kind === 'message').length;
  return 0;
}

export default function FilterTabs({ active, onSelect, items }: FilterTabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIdx = tabs.findIndex(t => t.key === active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight'
        ? (currentIdx + 1) % tabs.length
        : (currentIdx - 1 + tabs.length) % tabs.length;
      onSelect(tabs[next].key);
    }
  };

  return (
    <div className="filter-tabs" role="tablist" onKeyDown={handleKeyDown}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`filter-tabs__tab ${active === tab.key ? 'filter-tabs__tab--active' : ''}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          <span className="filter-tabs__badge">{countForTab(tab.key, items)}</span>
        </button>
      ))}
    </div>
  );
}
```

### 1d. Create src/webview/reports/components/BriefingReportCard.tsx

```typescript
import React from 'react';
import type { BriefingReportBody, ReportEnvelope } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface BriefingReportCardProps {
  report: ReportEnvelope;
  onReply: (reportId: string, reportType: string, timestamp: string) => void;
}

export default function BriefingReportCard({ report, onReply }: BriefingReportCardProps) {
  const body = report.body as BriefingReportBody;

  return (
    <div className="report-card briefing-card">
      <div className="report-card__header">
        <span className="report-card__icon">{'\u{1F4CB}'}</span>
        <span className="report-card__title">Briefing Report</span>
        <span className="report-card__timestamp">{relativeTime(report.generatedAt)}</span>
      </div>

      {body.blockers && body.blockers.length > 0 && (
        <div className="briefing-card__blockers">
          <div className="briefing-card__blockers-header">{'\u26A0'} Blockers</div>
          <ul className="briefing-card__blockers-list">
            {body.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {body.goals && body.goals.length > 0 && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Goals ({body.goals.length})</span>
          </summary>
          <ul className="report-card__section-content">
            {body.goals.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </details>
      )}

      {body.progressSummary && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Progress</span>
            <span className="report-card__section-preview">{body.progressSummary.slice(0, 60)}</span>
          </summary>
          <div className="report-card__section-content">{body.progressSummary}</div>
        </details>
      )}

      {body.nextSteps && body.nextSteps.length > 0 && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Next Steps ({body.nextSteps.length})</span>
          </summary>
          <ul className="report-card__section-content">
            {body.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}

      {body.metrics && Object.keys(body.metrics).length > 0 && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Metrics: {Object.keys(body.metrics).length} values</span>
          </summary>
          <div className="report-card__section-content briefing-card__metrics-grid">
            {Object.entries(body.metrics).map(([key, val]) => (
              <React.Fragment key={key}>
                <span className="briefing-card__metric-key">{key}</span>
                <span className="briefing-card__metric-value">{String(val)}</span>
              </React.Fragment>
            ))}
          </div>
        </details>
      )}

      <div className="report-card__footer">
        <button
          className="report-card__reply-btn"
          onClick={() => onReply(report.reportId, 'briefing', report.generatedAt)}
        >
          Reply
        </button>
      </div>
    </div>
  );
}
```

### 1e. Create src/webview/reports/components/RalphLoopReportCard.tsx

```typescript
import React from 'react';
import type { RalphReportBody, ReportEnvelope } from '@harnesstune/shared';
import { relativeTime, deltaClass, formatDelta } from '../utils';
import RalphLoopChart from './RalphLoopChart';

interface RalphLoopReportCardProps {
  report: ReportEnvelope;
  loopIterations: RalphReportBody[];
  onReply: (reportId: string, reportType: string, timestamp: string) => void;
}

export default function RalphLoopReportCard({ report, loopIterations, onReply }: RalphLoopReportCardProps) {
  const body = report.body as RalphReportBody;
  const metricNames = Object.keys(body.metrics ?? {});

  return (
    <div className="report-card ralph-card">
      <div className="report-card__header">
        <div className="ralph-card__title-group">
          <div className="report-card__title-row">
            <span className="report-card__icon">{'\u{1F504}'}</span>
            <span className="report-card__title">Ralph Loop #{body.iteration}</span>
          </div>
          <span className="ralph-card__loop-id">Loop: {body.loopId.slice(0, 8)}</span>
        </div>
        <span className="report-card__timestamp">{relativeTime(report.generatedAt)}</span>
      </div>

      <div className="ralph-card__summary">
        {body.whatChanged && (
          <div className="ralph-card__summary-row">
            <span className="ralph-card__summary-label">What changed</span>
            <span>{body.whatChanged}</span>
          </div>
        )}
        {body.cumulativeProgress && (
          <div className="ralph-card__summary-row">
            <span className="ralph-card__summary-label">Cumulative</span>
            <span>{body.cumulativeProgress}</span>
          </div>
        )}
      </div>

      {metricNames.length > 0 && (
        <div className="ralph-card__metrics-table-wrap">
          <table className="ralph-card__metrics-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Current</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {metricNames.map(name => {
                const current = body.metrics[name] as number;
                const baseline = body.baselineMetrics?.[name] as number | undefined;
                const delta = baseline !== undefined ? current - baseline : 0;
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{baseline !== undefined ? baseline : '\u2014'}</td>
                    <td>{current}</td>
                    <td className={deltaClass(delta)}>{baseline !== undefined ? formatDelta(delta) : '\u2014'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loopIterations.length >= 2 && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Show convergence chart</span>
          </summary>
          <div className="report-card__section-content">
            <RalphLoopChart iterations={loopIterations} />
          </div>
        </details>
      )}

      <div className="report-card__footer">
        <button
          className="report-card__reply-btn"
          onClick={() => onReply(report.reportId, 'ralph', report.generatedAt)}
        >
          Reply
        </button>
      </div>
    </div>
  );
}
```

### 1f. Create src/webview/reports/components/RalphLoopChart.tsx

Pure SVG convergence chart — no D3 dependency per D-03.

```typescript
import React, { useMemo } from 'react';
import type { RalphReportBody } from '@harnesstune/shared';

interface RalphLoopChartProps {
  iterations: RalphReportBody[];
}

const CHART_COLORS = [
  'var(--vscode-charts-blue)',
  'var(--vscode-charts-green)',
  'var(--vscode-charts-yellow)',
  'var(--vscode-charts-orange)',
  'var(--vscode-charts-red)',
  'var(--vscode-charts-purple)',
];

const PAD = { top: 8, right: 12, bottom: 24, left: 40 };

export default function RalphLoopChart({ iterations }: RalphLoopChartProps) {
  const sorted = useMemo(() =>
    [...iterations].sort((a, b) => a.iteration - b.iteration),
    [iterations]
  );

  const metricNames = useMemo(() => {
    const names = new Set<string>();
    for (const iter of sorted) {
      for (const key of Object.keys(iter.metrics ?? {})) names.add(key);
    }
    return Array.from(names);
  }, [sorted]);

  // Compute bounds
  const allValues = sorted.flatMap(iter =>
    metricNames.map(name => (iter.metrics?.[name] as number) ?? 0)
  );
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;

  const width = 400;
  const height = 160;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const xStep = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW;

  function toX(idx: number): number {
    return PAD.left + (sorted.length > 1 ? idx * xStep : plotW / 2);
  }

  function toY(val: number): number {
    return PAD.top + plotH - ((val - yMin) / yRange) * plotH;
  }

  // Grid lines (3 horizontal)
  const gridLines = [0, 0.5, 1].map(frac => yMin + frac * yRange);

  return (
    <div className="ralph-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="ralph-chart__svg">
        {/* Grid lines */}
        {gridLines.map((val, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={toY(val)}
              x2={width - PAD.right} y2={toY(val)}
              stroke="var(--vscode-widget-border)" strokeWidth="0.5" opacity="0.5"
            />
            <text
              x={PAD.left - 4} y={toY(val) + 3}
              textAnchor="end" fontSize="10"
              fill="var(--vscode-descriptionForeground)"
            >
              {Number(val.toFixed(2))}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {sorted.map((iter, i) => (
          <text
            key={i}
            x={toX(i)} y={height - 4}
            textAnchor="middle" fontSize="10"
            fill="var(--vscode-descriptionForeground)"
          >
            {iter.iteration}
          </text>
        ))}

        {/* Polylines + data points */}
        {metricNames.map((name, mi) => {
          const color = CHART_COLORS[mi % CHART_COLORS.length];
          const points = sorted.map((iter, i) => {
            const val = (iter.metrics?.[name] as number) ?? 0;
            return `${toX(i)},${toY(val)}`;
          }).join(' ');

          return (
            <g key={name}>
              <polyline
                points={points}
                fill="none" stroke={color} strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
              />
              {sorted.map((iter, i) => {
                const val = (iter.metrics?.[name] as number) ?? 0;
                return (
                  <circle
                    key={i}
                    cx={toX(i)} cy={toY(val)} r="2.5"
                    fill={color}
                  >
                    <title>{name}: {val}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="ralph-chart__legend">
        {metricNames.map((name, mi) => (
          <div key={name} className="ralph-chart__legend-item">
            <span
              className="ralph-chart__legend-swatch"
              style={{ background: CHART_COLORS[mi % CHART_COLORS.length] }}
            />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 1g. Create src/webview/reports/components/ChatBubble.tsx

```typescript
import React from 'react';
import type { RelayMessage } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface ChatBubbleProps {
  message: RelayMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.direction === 'to_agent';

  return (
    <div className={`chat-bubble chat-bubble--${isUser ? 'user' : 'agent'} chat-fade-in`}>
      <div className="chat-bubble__meta">
        <span className="chat-bubble__sender">{isUser ? 'You' : 'Agent'}</span>
        <span className="chat-bubble__time">{relativeTime(message.createdAt)}</span>
      </div>
      <div className="chat-bubble__body">{message.body.text}</div>
    </div>
  );
}
```

### 1h. Create src/webview/reports/components/MessageComposer.tsx

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { relativeTime } from '../utils';

interface MessageComposerProps {
  onSend: (text: string) => void;
  replyTo: { reportId: string; reportType: string; timestamp: string } | null;
  onCancelReply: () => void;
}

export default function MessageComposer({ onSend, replyTo, onCancelReply }: MessageComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when reply context is set
  useEffect(() => {
    if (replyTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyTo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSend(text.trim());
        setText('');
      }
    }
  }, [text, onSend]);

  const handleSend = useCallback(() => {
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  }, [text, onSend]);

  return (
    <div className="message-composer">
      {replyTo && (
        <div className="message-composer__reply-indicator">
          <span>Replying to {replyTo.reportType} from {relativeTime(replyTo.timestamp)}</span>
          <button
            className="message-composer__reply-dismiss"
            onClick={onCancelReply}
            aria-label="Cancel reply"
          >
            {'\u2715'}
          </button>
        </div>
      )}
      <div className="message-composer__row">
        <textarea
          ref={textareaRef}
          className="message-composer__input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your agent... (Enter to send)"
          rows={1}
        />
        <button
          className="message-composer__send"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

### 1i. Create src/webview/reports/components/LoadMoreButton.tsx

```typescript
import React from 'react';

interface LoadMoreButtonProps {
  onClick: () => void;
  loading: boolean;
}

export default function LoadMoreButton({ onClick, loading }: LoadMoreButtonProps) {
  return (
    <button
      className="load-more-btn"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? 'Loading...' : 'Load older'}
    </button>
  );
}
```

### 1j. Create src/webview/reports/components/EmptyState.tsx

```typescript
import React from 'react';
import type { FilterTab } from './FilterTabs';

interface EmptyStateProps {
  connectionStatus: 'connected' | 'stale' | 'error';
  filter: FilterTab;
  hasItems: boolean;
}

const typeNames: Record<FilterTab, string> = {
  all: 'items',
  briefings: 'briefings',
  ralph: 'ralph reports',
  chat: 'messages',
};

export default function EmptyState({ connectionStatus, filter, hasItems }: EmptyStateProps) {
  // Error state
  if (connectionStatus === 'error') {
    return (
      <div className="empty-state">
        <div className="empty-state__heading">Unable to reach relay</div>
        <div className="empty-state__body">Check your relay URL and network connection, then try refreshing.</div>
      </div>
    );
  }

  // Filtered empty
  if (hasItems && filter !== 'all') {
    return (
      <div className="empty-state">
        <div className="empty-state__heading">No {typeNames[filter]} found</div>
        <div className="empty-state__body">Try switching to a different filter.</div>
      </div>
    );
  }

  // No data at all
  return (
    <div className="empty-state">
      <div className="empty-state__heading">No reports yet</div>
      <div className="empty-state__body">Reports from your agent will appear here once they start sending.</div>
    </div>
  );
}
```

### 1k. Create src/webview/reports/components/TimelineFeed.tsx

Renders the feed of TimelineItems, dispatching to card components.

```typescript
import React from 'react';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import BriefingReportCard from './BriefingReportCard';
import RalphLoopReportCard from './RalphLoopReportCard';
import ChatBubble from './ChatBubble';

interface TimelineFeedProps {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  onReply: (reportId: string, reportType: string, timestamp: string) => void;
}

export default function TimelineFeed({ items, loopIterations, onReply }: TimelineFeedProps) {
  return (
    <div className="timeline-feed">
      {items.map((item, idx) => {
        if (item.kind === 'message') {
          return <ChatBubble key={`msg-${item.data.id}`} message={item.data} />;
        }
        if (item.data.type === 'briefing') {
          return <BriefingReportCard key={`rpt-${item.data.reportId}`} report={item.data} onReply={onReply} />;
        }
        if (item.data.type === 'ralph') {
          const body = item.data.body as RalphReportBody;
          const iterations = loopIterations[body.loopId] ?? [];
          return (
            <RalphLoopReportCard
              key={`rpt-${item.data.reportId}`}
              report={item.data}
              loopIterations={iterations}
              onReply={onReply}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
```

### 1l. Update App.tsx — replace placeholder with full component tree

Replace the entire return block in App.tsx. The shell from Plan 01 already has all state, handlers, and filtering logic. Replace the placeholder `<div className="report-panel__placeholder">` with the full component tree:

```typescript
// Add imports at top:
import PanelHeader from './components/PanelHeader';
import FilterTabs from './components/FilterTabs';
import type { FilterTab } from './components/FilterTabs';
import TimelineFeed from './components/TimelineFeed';
import MessageComposer from './components/MessageComposer';
import LoadMoreButton from './components/LoadMoreButton';
import EmptyState from './components/EmptyState';

// Replace FilterTab type alias with import (remove local type FilterTab = ...)

// Replace the return statement:
return (
  <div className="report-panel">
    <PanelHeader workspaceName={workspaceName} connectionStatus={connectionStatus} />
    <FilterTabs active={filter} onSelect={setFilter} items={items} />
    <div className="timeline-feed-container">
      {loading ? (
        <div className="timeline-loading">
          <span className="timeline-loading__dot" />
          <span className="timeline-loading__dot" />
          <span className="timeline-loading__dot" />
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          connectionStatus={connectionStatus}
          filter={filter}
          hasItems={items.length > 0}
        />
      ) : (
        <>
          {hasMore && (
            <LoadMoreButton onClick={handleLoadMore} loading={false} />
          )}
          <TimelineFeed
            items={filteredItems}
            loopIterations={loopIterations}
            onReply={handleReply}
          />
        </>
      )}
    </div>
    <MessageComposer
      onSend={handleSend}
      replyTo={replyTo}
      onCancelReply={() => setReplyTo(null)}
    />
  </div>
);
```

</action>

<acceptance_criteria>
- test -f src/webview/reports/utils.ts
- test -f src/webview/reports/components/PanelHeader.tsx
- test -f src/webview/reports/components/FilterTabs.tsx
- test -f src/webview/reports/components/BriefingReportCard.tsx
- test -f src/webview/reports/components/RalphLoopReportCard.tsx
- test -f src/webview/reports/components/RalphLoopChart.tsx
- test -f src/webview/reports/components/ChatBubble.tsx
- test -f src/webview/reports/components/MessageComposer.tsx
- test -f src/webview/reports/components/LoadMoreButton.tsx
- test -f src/webview/reports/components/EmptyState.tsx
- test -f src/webview/reports/components/TimelineFeed.tsx
- grep -q "PanelHeader" src/webview/reports/App.tsx
- grep -q "FilterTabs" src/webview/reports/App.tsx
- grep -q "TimelineFeed" src/webview/reports/App.tsx
- grep -q "MessageComposer" src/webview/reports/App.tsx
- npx tsc --noEmit exits 0
</acceptance_criteria>

---

## Task 2: reports.css + Human Verification

<read_first>
- src/webview/reports/styles/reports.css (reset from Plan 01 — extend)
- .planning/phases/10-report-timeline-ui-async-chat/10-UI-SPEC.md (full styling spec)
- src/webview/chat/styles/chat.css (scrollbar styling, fade-in animation, bubble patterns)
- src/webview/dashboard/styles/dashboard.css (card patterns, empty state)
</read_first>

<action>

### 2a. Replace reports.css with full stylesheet

Replace the minimal reset in `src/webview/reports/styles/reports.css` with the complete stylesheet per UI-SPEC. All values from the spacing scale, typography, color, and component specifications sections.

```css
/* ── Reset ─────────────────────────────────────────── */
body {
  margin: 0;
  padding: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.4;
}

/* ── Root layout ───────────────────────────────────── */
.report-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* ── PanelHeader ───────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 35px;
  padding: 0 16px;
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  flex-shrink: 0;
}

.panel-header__name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-header__status {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 9px;
}

.panel-header__status--connected {
  color: var(--vscode-charts-green);
  background: rgba(0, 200, 0, 0.12);
}

.panel-header__status--stale {
  color: var(--vscode-charts-yellow);
  background: rgba(200, 200, 0, 0.12);
}

.panel-header__status--error {
  color: var(--vscode-errorForeground);
  background: rgba(200, 0, 0, 0.12);
}

/* ── FilterTabs ────────────────────────────────────── */
.filter-tabs {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  flex-shrink: 0;
  gap: 0;
}

.filter-tabs__tab {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--vscode-tab-inactiveForeground);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
}

.filter-tabs__tab:hover {
  background: var(--vscode-list-hoverBackground);
}

.filter-tabs__tab--active {
  color: var(--vscode-tab-activeForeground);
  border-bottom-color: var(--vscode-focusBorder);
}

.filter-tabs__tab:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.filter-tabs__badge {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

/* ── Timeline feed ─────────────────────────────────── */
.timeline-feed-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.timeline-feed-container::-webkit-scrollbar {
  width: 6px;
}

.timeline-feed-container::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
  border-radius: 3px;
}

.timeline-feed-container::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}

.timeline-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
}

/* ── Loading dots ──────────────────────────────────── */
.timeline-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 32px;
  flex: 1;
}

.timeline-loading__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  animation: timeline-dot-pulse 1.2s ease-in-out infinite;
}

.timeline-loading__dot:nth-child(2) { animation-delay: 0.2s; }
.timeline-loading__dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes timeline-dot-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* ── Report cards (shared) ─────────────────────────── */
.report-card {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  background: transparent;
}

.report-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.report-card__icon {
  font-size: 14px;
  flex-shrink: 0;
}

.report-card__title {
  font-size: 13px;
  font-weight: 600;
}

.report-card__timestamp {
  margin-left: auto;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.report-card__section {
  border: none;
}

.report-card__section > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.report-card__section > summary::-webkit-details-marker {
  display: none;
}

.report-card__section > summary::before {
  content: '\u25B6';
  font-size: 8px;
  transition: transform 0.15s;
}

.report-card__section[open] > summary::before {
  transform: rotate(90deg);
}

.report-card__section > summary:hover {
  background: var(--vscode-list-hoverBackground);
}

.report-card__section-label {
  font-size: 13px;
  font-weight: 600;
}

.report-card__section-preview {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-card__section-content {
  padding: 4px 12px 8px 24px;
  font-size: 13px;
}

.report-card__section-content ul {
  margin: 0;
  padding-left: 16px;
}

.report-card__section-content li {
  margin-bottom: 2px;
}

.report-card__footer {
  padding: 6px 12px;
  border-top: 1px solid var(--vscode-widget-border);
}

.report-card__reply-btn {
  background: none;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.report-card__reply-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

/* ── Briefing card specifics ───────────────────────── */
.briefing-card__blockers {
  margin: 0 12px 8px;
  padding: 8px 12px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-left: 3px solid var(--vscode-errorForeground);
  border-radius: 4px;
}

.briefing-card__blockers-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-errorForeground);
  margin-bottom: 4px;
}

.briefing-card__blockers-list {
  margin: 0;
  padding-left: 16px;
  list-style: disc;
}

.briefing-card__blockers-list li {
  margin-bottom: 2px;
}

.briefing-card__metrics-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
}

.briefing-card__metric-key {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.briefing-card__metric-value {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--vscode-editor-font-family);
}

/* ── Ralph card specifics ──────────────────────────── */
.ralph-card__title-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ralph-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ralph-card__loop-id {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  padding-left: 22px;
}

.ralph-card__summary {
  padding: 8px 12px;
}

.ralph-card__summary-row {
  margin-bottom: 4px;
  font-size: 13px;
}

.ralph-card__summary-label {
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
}

.ralph-card__metrics-table-wrap {
  padding: 0 12px 8px;
}

.ralph-card__metrics-table {
  width: 100%;
  border-collapse: collapse;
}

.ralph-card__metrics-table thead th {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-widget-border);
}

.ralph-card__metrics-table tbody td {
  font-size: 13px;
  font-family: var(--vscode-editor-font-family);
  padding: 4px 8px;
}

.delta-positive { color: var(--vscode-terminal-ansiGreen); }
.delta-negative { color: var(--vscode-terminal-ansiRed); }
.delta-zero { color: var(--vscode-descriptionForeground); }

/* ── Ralph convergence chart ───────────────────────── */
.ralph-chart {
  padding: 8px 12px;
}

.ralph-chart__svg {
  width: 100%;
  height: 160px;
}

.ralph-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.ralph-chart__legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.ralph-chart__legend-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

/* ── Chat bubbles ──────────────────────────────────── */
.chat-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 6px;
}

.chat-bubble--user {
  align-self: flex-end;
  background: var(--vscode-textBlockQuote-background);
  border: 1px solid var(--vscode-widget-border);
}

.chat-bubble--agent {
  align-self: flex-start;
  background: transparent;
}

.chat-bubble__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.chat-bubble__sender {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
}

.chat-bubble__time {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
}

.chat-bubble__body {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-fade-in {
  animation: chat-fade-in 0.2s ease-out;
}

@keyframes chat-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Message composer ──────────────────────────────── */
.message-composer {
  flex-shrink: 0;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.message-composer__reply-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: var(--vscode-textBlockQuote-background);
  border-left: 2px solid var(--vscode-textLink-foreground);
  border-radius: 2px;
  margin: 8px 12px 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.message-composer__reply-dismiss {
  background: none;
  border: none;
  font-size: 11px;
  padding: 2px;
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
}

.message-composer__reply-dismiss:hover {
  color: var(--vscode-foreground);
}

.message-composer__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px 10px;
}

.message-composer__input {
  flex: 1;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 8px 10px;
  font: inherit;
  color: var(--vscode-input-foreground);
  resize: none;
  min-height: 36px;
  max-height: 120px;
}

.message-composer__input:focus {
  border-color: var(--vscode-focusBorder);
  outline: none;
}

.message-composer__send {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
}

.message-composer__send:hover {
  background: var(--vscode-button-hoverBackground);
}

.message-composer__send:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Load more ─────────────────────────────────────── */
.load-more-btn {
  align-self: center;
  margin: 8px auto;
  display: block;
  padding: 4px 16px;
  background: transparent;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
}

.load-more-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

.load-more-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Empty state ───────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  color: var(--vscode-descriptionForeground);
}

.empty-state__heading {
  font-size: 13px;
  font-weight: 600;
}

.empty-state__body {
  font-size: 13px;
  text-align: center;
}
```

</action>

<human_verify>

**Checkpoint — 12 checks before marking Phase 10 complete:**

1. **Build passes:** `node esbuild.mjs` exits 0. `npx tsc --noEmit` exits 0.
2. **Panel opens:** Run `HarnessTune: Open Reports` command from palette for a remote workspace → WebviewPanel opens with title "HarnessTune Reports - {name}".
3. **Header renders:** Panel header shows workspace name and connection status pill (Connected/Stale/Error).
4. **Filter tabs work:** 4 tabs visible (All, Briefings, Ralph, Chat). Clicking tab filters timeline. Count badges update. Arrow keys navigate tabs.
5. **Briefing card layout:** Briefing reports render with icon, title, timestamp. Blockers section expanded with amber call-out when present. Goals/Progress/Next Steps/Metrics sections collapsed. Click expands.
6. **Ralph card layout:** Ralph loop reports render with iteration number, loop ID, what-changed/cumulative text, metrics table with color-coded deltas.
7. **Convergence chart:** When 2+ iterations exist for a loopId, "Show convergence chart" toggle appears. Chart renders SVG polylines with legend.
8. **Chat bubbles:** User messages right-aligned with background. Agent messages left-aligned, transparent. Sender labels and timestamps visible.
9. **Message composer:** Fixed at bottom. Textarea placeholder visible. Enter sends, Shift+Enter newline. Send button disabled when empty.
10. **Reply flow:** Click Reply on a report card → reply indicator appears above textarea → textarea focused → send message → indicator clears.
11. **Empty states:** With no reports: "No reports yet" message. With error status: "Unable to reach relay" message. With filter but no matches: "No {type} found" message.
12. **Load older:** "Load older" button at top of timeline. Click fetches older items.

</human_verify>

<acceptance_criteria>
- wc -l src/webview/reports/styles/reports.css shows > 200 lines
- grep -q "panel-header" src/webview/reports/styles/reports.css
- grep -q "filter-tabs" src/webview/reports/styles/reports.css
- grep -q "report-card" src/webview/reports/styles/reports.css
- grep -q "chat-bubble" src/webview/reports/styles/reports.css
- grep -q "message-composer" src/webview/reports/styles/reports.css
- grep -q "empty-state" src/webview/reports/styles/reports.css
- grep -q "ralph-chart" src/webview/reports/styles/reports.css
- grep -q "briefing-card__blockers" src/webview/reports/styles/reports.css
- grep -q "chat-fade-in" src/webview/reports/styles/reports.css
- node esbuild.mjs exits 0
- npx tsc --noEmit exits 0
</acceptance_criteria>
