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
