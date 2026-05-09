import fs from 'node:fs';
import path from 'node:path';

describe('relay schema includes run summary persistence', () => {
  it('adds a summary column to agent_runs and creates a drizzle migration', () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/src/db/schema.ts'),
      'utf-8',
    );
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/0001_r1_add_run_summary.sql'),
      'utf-8',
    );
    const journal = fs.readFileSync(
      path.join(process.cwd(), 'packages/harnesstune-relay/drizzle/meta/_journal.json'),
      'utf-8',
    );

    expect(schema).toContain("summary: text('summary')");
    expect(migration).toContain('ALTER TABLE agent_runs ADD COLUMN summary text;');
    expect(journal).toContain('"tag": "0001_r1_add_run_summary"');
  });
});
