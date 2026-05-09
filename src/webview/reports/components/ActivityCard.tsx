import React from 'react';
import type { ActivityItem } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface ActivityCardProps {
  activity: ActivityItem;
  at: string;
}

const eventLabels: Record<string, string> = {
  PreToolUse: 'Tool Call',
  PostToolUse: 'Tool Result',
  PostToolUseFailure: 'Tool Error',
  Stop: 'Stopped',
  StopFailure: 'Stop Failed',
  SubagentStart: 'Subagent Started',
  SubagentStop: 'Subagent Stopped',
};

const eventIcons: Record<string, string> = {
  PreToolUse: '\u{1F527}',
  PostToolUse: '\u2705',
  PostToolUseFailure: '\u274C',
  Stop: '\u23F9',
  StopFailure: '\u26A0',
  SubagentStart: '\u{1F916}',
  SubagentStop: '\u{1F916}',
};

export default function ActivityCard({ activity, at }: ActivityCardProps) {
  const label = eventLabels[activity.eventType] ?? activity.eventType;
  const icon = eventIcons[activity.eventType] ?? '\u{1F4AC}';

  return (
    <div className={`report-card activity-card${activity.error ? ' activity-card--error' : ''}`}>
      <div className="report-card__header">
        <span className="report-card__icon">{icon}</span>
        <span className="report-card__title">{label}</span>
        {activity.toolName && (
          <span className="activity-card__tool-name">{activity.toolName}</span>
        )}
        <span className="report-card__timestamp">{relativeTime(at)}</span>
      </div>
      {activity.error && (
        <div className="activity-card__error">{activity.error}</div>
      )}
      {(activity.inputTokens || activity.outputTokens) && (
        <div className="activity-card__tokens">
          {activity.inputTokens && <span>{activity.inputTokens.toLocaleString()} in</span>}
          {activity.outputTokens && <span>{activity.outputTokens.toLocaleString()} out</span>}
          {activity.model && <span className="activity-card__model">{activity.model}</span>}
        </div>
      )}
    </div>
  );
}
