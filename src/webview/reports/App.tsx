import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import vscode from './vscodeApi';
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
  // UI-only display limit. Start by showing just the most recent message + reply.
  // Each "Load older" click reveals INITIAL_PAGE_SIZE more items already in memory
  // before falling back to a backend fetch for older history.
  const INITIAL_PAGE_SIZE = 2;
  const PAGE_INCREMENT = 10;
  const [displayLimit, setDisplayLimit] = useState<number>(INITIAL_PAGE_SIZE);

  // Track items.length across renders so we can grow displayLimit whenever new
  // items arrive (e.g. the user sends a message, claude replies). Without this,
  // the auto-refresh tick re-renders with displayLimit frozen at 2 — so newly
  // arrived messages stay hidden behind "Load older". We want new arrivals to
  // be visible automatically; "Load older" only reveals OLDER history.
  const prevItemsLengthRef = useRef<number>(items.length);
  useEffect(() => {
    const delta = items.length - prevItemsLengthRef.current;
    if (delta > 0) {
      setDisplayLimit(prev => prev + delta);
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length]);

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
    // Auto-refresh every 15s so new chat responses appear without reopening the
    // panel. 5s was too aggressive — getTimelineItems on the host fans out into
    // 1 + 1 + N getReport(id) calls (one per chat_response to fetch the body)
    // and burns through the relay's 60-req/min-per-token budget.
    const refresh = setInterval(() => {
      vscode.postMessage({ type: 'timeline:requestInitial', workspaceId: '' });
    }, 15000);
    return () => {
      window.removeEventListener('message', handler);
      clearInterval(refresh);
    };
  }, []);

  // Filter items
  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'activity') return item.kind === 'activity';
    if (filter === 'briefings') return item.kind === 'report' && item.data.type === 'briefing';
    if (filter === 'ralph') return item.kind === 'report' && item.data.type === 'ralph';
    if (filter === 'chat') return item.kind === 'message' || (item.kind === 'report' && item.data.type === 'chat_response');
    return true;
  });

  // Re-thread chat: pair each user message (Q) with its agent reply (A) so the
  // conversation reads Q1 → A1 → Q2 → A2 even when A1 arrives after Q2.
  // chat_response carries body.inReplyTo === Q.id; we use that to attach the
  // reply right after its question instead of in raw timestamp order.
  //
  // Dedup contract: when the relay holds multiple chat_responses with the same
  // inReplyTo (an old SIGTERM-orphan-attach bug occasionally produced two of
  // these), only the LATEST one renders. Older duplicates that would otherwise
  // appear at their original timestamp are dropped — they're never the answer
  // the user wants to see.
  //
  // Non-paired items (briefings, ralph, activity, replies with no matching Q)
  // stay at their own timestamp position.
  const threadedItems = React.useMemo(() => {
    // Sort oldest-first for threading
    const chrono = [...filteredItems].sort((a, b) => a.at.localeCompare(b.at));
    // Map inReplyTo → the latest chat_response with that inReplyTo. Because we
    // iterate chrono (oldest → newest), .set overwrites earlier dupes.
    const replyByMessageId = new Map<string, TimelineItem>();
    // Set of reportIds we will hide — earlier duplicates whose inReplyTo points
    // at the same question as a later chat_response.
    const duplicateReplyIds = new Set<string>();
    for (const it of chrono) {
      if (it.kind === 'report' && it.data.type === 'chat_response') {
        const body = it.data.body as { inReplyTo?: string };
        if (body?.inReplyTo) {
          const prev = replyByMessageId.get(body.inReplyTo);
          if (prev && prev.kind === 'report') {
            duplicateReplyIds.add(prev.data.reportId);
          }
          replyByMessageId.set(body.inReplyTo, it);
        }
      }
    }
    const placedReplies = new Set<string>();
    const out: TimelineItem[] = [];
    for (const it of chrono) {
      if (it.kind === 'report' && it.data.type === 'chat_response') {
        if (placedReplies.has(it.data.reportId)) continue; // already inserted right after its question
        if (duplicateReplyIds.has(it.data.reportId)) continue; // older duplicate, hide
      }
      out.push(it);
      if (it.kind === 'message' && it.data.direction === 'to_agent') {
        const reply = replyByMessageId.get(it.data.id);
        if (reply && reply.kind === 'report') {
          out.push(reply);
          placedReplies.add(reply.data.reportId);
        }
      }
    }
    return out; // oldest-first
  }, [filteredItems]);

  // Display the most recent `displayLimit` items. threadedItems is oldest-first;
  // slice the tail, then reverse so array index 0 is newest (column-reverse CSS
  // then renders newest at the visual bottom — standard chat layout).
  const tail = threadedItems.slice(Math.max(0, threadedItems.length - displayLimit));
  const visibleItems = [...tail].reverse();
  const moreInMemory = threadedItems.length > displayLimit;
  const showLoadMore = moreInMemory || hasMore;

  // Auto-scroll to the newest item when items arrive or are first rendered.
  // With column-reverse, scrollTop = 0 means "visually at the bottom" (newest).
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = feedContainerRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [visibleItems.length]);

  const handleSend = useCallback((text: string) => {
    // Optimistic append — show the message immediately
    const now = new Date().toISOString();
    const optimisticItem: TimelineItem = {
      kind: 'message',
      data: {
        id: `local-${Date.now()}`,
        channelId: '',
        direction: 'to_agent' as const,
        body: { text, sentAt: now, inReplyToReportId: replyTo?.reportId },
        createdAt: now,
      },
      at: now,
    };
    setItems(prev => [optimisticItem, ...prev]);

    vscode.postMessage({
      type: 'timeline:sendMessage',
      workspaceId,
      text,
      inReplyToReportId: replyTo?.reportId,
    });
    setReplyTo(null);
  }, [workspaceId, replyTo]);

  const handleLoadMore = useCallback(() => {
    // First exhaust items already in memory by bumping the display window.
    // Only fetch from the backend when we've revealed everything in memory.
    setDisplayLimit(prev => {
      const next = prev + PAGE_INCREMENT;
      if (next >= filteredItems.length && hasMore) {
        const oldest = items[items.length - 1];
        if (oldest) {
          vscode.postMessage({ type: 'timeline:loadMore', workspaceId, before: oldest.at });
        }
      }
      return next;
    });
  }, [items, filteredItems.length, hasMore, workspaceId]);

  const handleReply = useCallback((reportId: string, reportType: string, timestamp: string) => {
    setReplyTo({ reportId, reportType, timestamp });
  }, []);

  return (
    <div className="report-panel">
      <FilterTabs active={filter} onSelect={setFilter} items={items} connectionStatus={connectionStatus} />
      <div className="timeline-feed-container" ref={feedContainerRef}>
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
            {showLoadMore && (
              <LoadMoreButton onClick={handleLoadMore} loading={false} />
            )}
            <TimelineFeed
              items={visibleItems}
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
