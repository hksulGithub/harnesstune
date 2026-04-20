import React, { useMemo } from 'react';
import type { RalphReportBody } from '@harnesstune/shared';

interface RalphLoopChartProps {
  iterations: RalphReportBody[];
}

const CHART_COLORS = [
  'var(--vscode-charts-blue)',
  'var(--vscode-charts-green)',
  'var(--vscode-charts-yellow)',
  'var(--vscode-charts-orange)',
  'var(--vscode-charts-red)',
  'var(--vscode-charts-purple)',
];

const PAD = { top: 8, right: 12, bottom: 24, left: 40 };

export default function RalphLoopChart({ iterations }: RalphLoopChartProps) {
  const sorted = useMemo(() =>
    [...iterations].sort((a, b) => a.iteration - b.iteration),
    [iterations]
  );

  const metricNames = useMemo(() => {
    const names = new Set<string>();
    for (const iter of sorted) {
      for (const key of Object.keys(iter.metrics ?? {})) names.add(key);
    }
    return Array.from(names);
  }, [sorted]);

  // Compute bounds
  const allValues = sorted.flatMap(iter =>
    metricNames.map(name => (iter.metrics?.[name] as number) ?? 0)
  );
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;

  const width = 400;
  const height = 160;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const xStep = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW;

  function toX(idx: number): number {
    return PAD.left + (sorted.length > 1 ? idx * xStep : plotW / 2);
  }

  function toY(val: number): number {
    return PAD.top + plotH - ((val - yMin) / yRange) * plotH;
  }

  // Grid lines (3 horizontal)
  const gridLines = [0, 0.5, 1].map(frac => yMin + frac * yRange);

  return (
    <div className="ralph-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="ralph-chart__svg">
        {/* Grid lines */}
        {gridLines.map((val, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={toY(val)}
              x2={width - PAD.right} y2={toY(val)}
              stroke="var(--vscode-widget-border)" strokeWidth="0.5" opacity="0.5"
            />
            <text
              x={PAD.left - 4} y={toY(val) + 3}
              textAnchor="end" fontSize="10"
              fill="var(--vscode-descriptionForeground)"
            >
              {Number(val.toFixed(2))}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {sorted.map((iter, i) => (
          <text
            key={i}
            x={toX(i)} y={height - 4}
            textAnchor="middle" fontSize="10"
            fill="var(--vscode-descriptionForeground)"
          >
            {iter.iteration}
          </text>
        ))}

        {/* Polylines + data points */}
        {metricNames.map((name, mi) => {
          const color = CHART_COLORS[mi % CHART_COLORS.length];
          const points = sorted.map((iter, i) => {
            const val = (iter.metrics?.[name] as number) ?? 0;
            return `${toX(i)},${toY(val)}`;
          }).join(' ');

          return (
            <g key={name}>
              <polyline
                points={points}
                fill="none" stroke={color} strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
              />
              {sorted.map((iter, i) => {
                const val = (iter.metrics?.[name] as number) ?? 0;
                return (
                  <circle
                    key={i}
                    cx={toX(i)} cy={toY(val)} r="2.5"
                    fill={color}
                  >
                    <title>{name}: {val}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="ralph-chart__legend">
        {metricNames.map((name, mi) => (
          <div key={name} className="ralph-chart__legend-item">
            <span
              className="ralph-chart__legend-swatch"
              style={{ background: CHART_COLORS[mi % CHART_COLORS.length] }}
            />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
