import React from 'react';
import type { ReportEnvelope, RunReport, RunReportSummary } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface RunBatchReportCardProps {
  report: ReportEnvelope;
}

function readSingleRun(report: ReportEnvelope): RunReport | null {
  const body = report.body as { runs?: RunReport[] };
  if (!Array.isArray(body.runs) || body.runs.length === 0) {
    return null;
  }
  return body.runs[0] ?? null;
}

function renderSummary(summary: RunReportSummary | undefined): React.ReactElement {
  if (!summary) {
    return <div className="report-card__empty">No summary captured.</div>;
  }

  if (summary.status === 'error') {
    return <div className="report-card__error">Summary unavailable: {summary.reason}</div>;
  }

  return (
    <>
      <div className="report-card__inline-summary">{summary.oneLineSummary}</div>
      <details className="report-card__section">
        <summary>Details</summary>
        <ul className="report-card__section-content">
          {summary.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
        </ul>
        <div className="report-card__tags">{summary.tags.join(', ')}</div>
      </details>
    </>
  );
}

export default function RunBatchReportCard({ report }: RunBatchReportCardProps) {
  const run = readSingleRun(report);
  const summary = run?.summary;

  return (
    <div className="report-card briefing-card">
      <div className="report-card__header">
        <span className="report-card__icon">Run</span>
        <span className="report-card__title">{run?.agentId ?? 'Unknown agent'}</span>
        <span className="report-card__timestamp">{relativeTime(report.generatedAt)}</span>
      </div>
      {renderSummary(summary)}
    </div>
  );
}
