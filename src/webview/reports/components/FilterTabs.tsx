import React from 'react';
import type { TimelineItem } from '@harnesstune/shared';

export type FilterTab = 'all' | 'briefings' | 'ralph' | 'chat' | 'activity';

interface FilterTabsProps {
  active: FilterTab;
  onSelect: (tab: FilterTab) => void;
  items: TimelineItem[];
  connectionStatus?: 'connected' | 'stale' | 'error';
}

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'activity', label: 'Activity' },
  { key: 'briefings', label: 'Briefings' },
  { key: 'ralph', label: 'Ralph' },
  { key: 'chat', label: 'Chat' },
];

function countForTab(tab: FilterTab, items: TimelineItem[]): number {
  if (tab === 'all') return items.length;
  if (tab === 'activity') return items.filter(i => i.kind === 'activity').length;
  if (tab === 'briefings') return items.filter(i => i.kind === 'report' && i.data.type === 'briefing').length;
  if (tab === 'ralph') return items.filter(i => i.kind === 'report' && i.data.type === 'ralph').length;
  if (tab === 'chat') return items.filter(i => i.kind === 'message').length;
  return 0;
}

const statusLabels: Record<string, string> = {
  connected: 'Connected',
  stale: 'Stale',
  error: 'Error',
};

export default function FilterTabs({ active, onSelect, items, connectionStatus }: FilterTabsProps) {
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
      {connectionStatus && (
        <span className={`panel-header__status panel-header__status--${connectionStatus}`} style={{ marginLeft: 'auto', marginRight: '12px' }}>
          {statusLabels[connectionStatus]}
        </span>
      )}
    </div>
  );
}
