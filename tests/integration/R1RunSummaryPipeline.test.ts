import fs from 'node:fs';
import path from 'node:path';

describe('runCycle forwards summary-bearing run reports unchanged', () => {
  it('serializes the existing RunReport.summary field into the run_batch upload', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-collector/src/daemon/scheduler.ts'),
      'utf-8',
    );

    expect(source).toContain('body: { runs: [run] }');
    expect(source).not.toContain('delete run.summary');
  });
});
