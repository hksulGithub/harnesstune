import React from 'react';
import type { TimelineItem, RalphReportBody, RelayMessage } from '@harnesstune/shared';
import BriefingReportCard from './BriefingReportCard';
import RalphLoopReportCard from './RalphLoopReportCard';
import ChatBubble from './ChatBubble';
import ActivityCard from './ActivityCard';

interface TimelineFeedProps {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  onReply: (reportId: string, reportType: string, timestamp: string) => void;
}

export default function TimelineFeed({ items, loopIterations, onReply }: TimelineFeedProps) {
  return (
    <div className="timeline-feed">
      {items.map((item, idx) => {
        if (item.kind === 'activity') {
          return <ActivityCard key={`act-${idx}`} activity={item.data} at={item.at} />;
        }
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
        if (item.data.type === 'chat_response') {
          const body = item.data.body as { text?: string; flushedAt?: string };
          const text = body.text ?? '';
          if (!text.trim()) return null;
          const pseudoMessage: RelayMessage = {
            id: item.data.reportId,
            channelId: '',
            direction: 'from_agent',
            body: { text },
            createdAt: body.flushedAt ?? item.at,
          };
          return <ChatBubble key={`chat-${item.data.reportId}`} message={pseudoMessage} />;
        }
        return null;
      })}
    </div>
  );
}
