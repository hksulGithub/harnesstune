import fs from 'node:fs';
import path from 'node:path';

describe('RunBatchReportCard rendering contract', () => {
  it('renders oneLineSummary inline and keeps bullets/tags behind details', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/webview/reports/components/RunBatchReportCard.tsx'),
      'utf-8',
    );

    expect(source).toContain('oneLineSummary');
    expect(source).toContain('<details');
    expect(source).toContain('summary.status === \'error\'');
  });
});
