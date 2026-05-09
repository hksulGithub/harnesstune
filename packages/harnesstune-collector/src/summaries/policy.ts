import type { SummaryMode, SummaryModeString } from './types.js';

export function parseSummaryMode(input: unknown): SummaryMode {
  if (input === undefined || input === null || input === 'on') {
    return { kind: 'on' };
  }
  if (input === 'off') {
    return { kind: 'off' };
  }
  if (typeof input === 'string') {
    const match = /^sample-1-in-(\d+)$/.exec(input);
    if (match) {
      const every = Number(match[1]);
      if (Number.isInteger(every) && every > 1) {
        return { kind: 'sample', every };
      }
    }
  }
  return { kind: 'on' };
}

export function shouldSummarizeRun(mode: SummaryMode, runNumber: number): boolean {
  if (mode.kind === 'off') {
    return false;
  }
  if (mode.kind === 'on') {
    return true;
  }
  return runNumber % mode.every === 0;
}

export function stringifySummaryMode(mode: SummaryMode): SummaryModeString {
  if (mode.kind === 'off') return 'off';
  if (mode.kind === 'on') return 'on';
  return `sample-1-in-${mode.every}`;
}
