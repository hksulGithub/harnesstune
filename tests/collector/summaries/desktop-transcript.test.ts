import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeDesktopTranscriptPath } from '../../../packages/harnesstune-collector/src/summaries/desktop-transcript';

describe('resolveClaudeDesktopTranscriptPath', () => {
  it('maps session metadata to a sibling transcript markdown file when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-transcript-'));
    const sessionPath = path.join(root, 'local_abc.json');
    const transcriptPath = path.join(root, 'local_abc.md');

    fs.writeFileSync(sessionPath, JSON.stringify({
      sessionId: 'abc',
      scheduledTaskId: 'test-1',
      createdAt: 1,
      lastActivityAt: 2,
      isArchived: false,
      title: 'Test',
      model: 'claude-sonnet-4',
    }));
    fs.writeFileSync(transcriptPath, '# transcript');

    expect(resolveClaudeDesktopTranscriptPath(sessionPath)).toBe(transcriptPath);
  });

  it('returns null when no transcript companion file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-transcript-'));
    const sessionPath = path.join(root, 'local_missing.json');
    fs.writeFileSync(sessionPath, '{}');

    expect(resolveClaudeDesktopTranscriptPath(sessionPath)).toBeNull();
  });
});
