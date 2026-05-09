import { parseSummaryMode, shouldSummarizeRun } from '../../packages/harnesstune-collector/src/summaries/policy';

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
