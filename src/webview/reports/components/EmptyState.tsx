import React from 'react';
import type { FilterTab } from './FilterTabs';

interface EmptyStateProps {
  connectionStatus: 'connected' | 'stale' | 'error';
  filter: FilterTab;
  hasItems: boolean;
}

const typeNames: Record<FilterTab, string> = {
  all: 'items',
  activity: 'activity events',
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
