import { parseSummaryMode, shouldSummarizeRun, stringifySummaryMode } from '../../packages/harnesstune-collector/src/summaries/policy';

describe('summary sampling policy', () => {
  it('defaults missing config to on', () => {
    expect(parseSummaryMode(undefined)).toEqual({ kind: 'on' });
  });

  it('parses sample mode and only keeps every nth run', () => {
    expect(parseSummaryMode('sample-1-in-5')).toEqual({ kind: 'sample', every: 5 });
    expect(shouldSummarizeRun({ kind: 'sample', every: 5 }, 10)).toBe(true);
    expect(shouldSummarizeRun({ kind: 'sample', every: 5 }, 11)).toBe(false);
  });

  it('turns summaries off explicitly', () => {
    expect(parseSummaryMode('off')).toEqual({ kind: 'off' });
    expect(shouldSummarizeRun({ kind: 'off' }, 1)).toBe(false);
  });
});

describe('parseSummaryMode malformed input falls back to on', () => {
  it('rejects sample-1-in-1 (every must be > 1)', () => {
    expect(parseSummaryMode('sample-1-in-1')).toEqual({ kind: 'on' });
  });

  it('rejects sample-1-in-0 (zero would divide-by-zero)', () => {
    expect(parseSummaryMode('sample-1-in-0')).toEqual({ kind: 'on' });
  });

  it('rejects sample-1-in-abc (regex fails)', () => {
    expect(parseSummaryMode('sample-1-in-abc')).toEqual({ kind: 'on' });
  });

  it('rejects Sample-1-IN-5 (case-sensitive regex)', () => {
    expect(parseSummaryMode('Sample-1-IN-5')).toEqual({ kind: 'on' });
  });

  it('rejects null', () => {
    expect(parseSummaryMode(null)).toEqual({ kind: 'on' });
  });

  it('rejects undefined', () => {
    expect(parseSummaryMode(undefined)).toEqual({ kind: 'on' });
  });

  it('rejects a number (42)', () => {
    expect(parseSummaryMode(42)).toEqual({ kind: 'on' });
  });
});

describe('parseSummaryMode / stringifySummaryMode round-trip', () => {
  it('round-trips sample-1-in-7, on, and off', () => {
    expect(stringifySummaryMode(parseSummaryMode('sample-1-in-7'))).toBe('sample-1-in-7');
    expect(stringifySummaryMode(parseSummaryMode('on'))).toBe('on');
    expect(stringifySummaryMode(parseSummaryMode('off'))).toBe('off');
  });
});
