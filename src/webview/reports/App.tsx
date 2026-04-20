import React, { useState, useEffect, useCallback } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import vscode from './vscodeApi';
import PanelHeader from './components/PanelHeader';
import FilterTabs from './components/FilterTabs';
import type { FilterTab } from './components/FilterTabs';
import TimelineFeed from './components/TimelineFeed';
import MessageComposer from './components/MessageComposer';
import LoadMoreButton from './components/LoadMoreButton';
import EmptyState from './components/EmptyState';

interface AppState {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  filter: FilterTab;
  connectionStatus: 'connected' | 'stale' | 'error';
  workspaceName: string;
  workspaceId: string;
  hasMore: boolean;
  loading: boolean;
  replyTo: { reportId: string; reportType: string; timestamp: string } | null;
}

export default function App() {
  const savedState = vscode.getState() as Partial<AppState> | null;
  const [items, setItems] = useState<TimelineItem[]>(savedState?.items ?? []);
  const [loopIterations, setLoopIterations] = useState<Record<string, RalphReportBody[]>>(savedState?.loopIterations ?? {});
  const [filter, setFilter] = useState<FilterTab>(savedState?.filter ?? 'all');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'stale' | 'error'>(savedState?.connectionStatus ?? 'connected');
  const [workspaceName, setWorkspaceName] = useState(savedState?.workspaceName ?? '');
  const [workspaceId, setWorkspaceId] = useState(savedState?.workspaceId ?? '');
  const [hasMore, setHasMore] = useState(savedState?.hasMore ?? true);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<AppState['replyTo']>(null);

  // Persist state
  useEffect(() => {
    vscode.setState({ items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore });
  }, [items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore]);

  // Message handler
  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'timeline:update':
          setItems(msg.items);
          setHasMore(msg.hasMore);
          setWorkspaceId(msg.workspaceId);
          setLoading(false);
          break;
        case 'timeline:loopIterations':
          setLoopIterations(msg.loopIterations);
          break;
        case 'timeline:append':
          setItems(prev => [...msg.items, ...prev]);
          break;
        case 'timeline:connectionStatus':
          setConnectionStatus(msg.status);
          break;
        case 'chat:workspaceInfo':
          setWorkspaceName(msg.workspaceName);
          setWorkspaceId(msg.workspaceId);
          break;
      }
    };
    window.addEventListener('message', handler);
    // Request initial data
    vscode.postMessage({ type: 'timeline:requestInitial', workspaceId: '' });
    return () => window.removeEventListener('message', handler);
  }, []);

  // Filter items
  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'briefings') return item.kind === 'report' && item.data.type === 'briefing';
    if (filter === 'ralph') return item.kind === 'report' && item.data.type === 'ralph';
    if (filter === 'chat') return item.kind === 'message';
    return true;
  });

  const handleSend = useCallback((text: string) => {
    vscode.postMessage({
      type: 'timeline:sendMessage',
      workspaceId,
      text,
      inReplyToReportId: replyTo?.reportId,
    });
    setReplyTo(null);
  }, [workspaceId, replyTo]);

  const handleLoadMore = useCallback(() => {
    const oldest = items[items.length - 1];
    if (oldest) {
      vscode.postMessage({ type: 'timeline:loadMore', workspaceId, before: oldest.at });
    }
  }, [items, workspaceId]);

  const handleReply = useCallback((reportId: string, reportType: string, timestamp: string) => {
    setReplyTo({ reportId, reportType, timestamp });
  }, []);

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
}
