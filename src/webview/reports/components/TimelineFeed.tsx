import React from 'react';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import BriefingReportCard from './BriefingReportCard';
import RalphLoopReportCard from './RalphLoopReportCard';
import ChatBubble from './ChatBubble';
import ActivityCard from './ActivityCard';
import RunBatchReportCard from './RunBatchReportCard';

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
          return <RalphLoopReportCard key={`rpt-${item.data.reportId}`} report={item.data} loopIterations={iterations} onReply={onReply} />;
        }
        if (item.data.type === 'run_batch') {
          return <RunBatchReportCard key={`rpt-${item.data.reportId}`} report={item.data} />;
        }
        return null;
      })}
    </div>
  );
}
