import type { RunReportSummary } from '@harnesstune/shared';

export type SummaryModeString = 'on' | 'off' | `sample-1-in-${number}`;

export type SummaryMode =
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'sample'; every: number };

export type SummaryResult = RunReportSummary;
