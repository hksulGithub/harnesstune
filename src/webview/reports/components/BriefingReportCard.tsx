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

      {body.progress && (
        <details className="report-card__section">
          <summary>
            <span className="report-card__section-label">Progress</span>
            <span className="report-card__section-preview">{body.progress.slice(0, 60)}</span>
          </summary>
          <div className="report-card__section-content">{body.progress}</div>
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
