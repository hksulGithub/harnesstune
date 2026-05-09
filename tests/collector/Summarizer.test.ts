import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeTranscript } from '../../packages/harnesstune-collector/src/summaries/summarizer';

describe('summarizeTranscript', () => {
  it('returns ok summary when claude prints valid JSON', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarizer-test-'));
    const transcriptPath = path.join(tmp, 'transcript.md');
    fs.writeFileSync(transcriptPath, 'did a thing');

    const result = await summarizeTranscript(transcriptPath, {
      timeoutMs: 1000,
      spawnImpl: async () => ({
        code: 0,
        stdout: JSON.stringify({
          oneLineSummary: 'Did a thing.',
          bullets: ['Opened file', 'Edited file'],
          tags: ['edit'],
          tokenCount: 321,
        }),
        stderr: '',
      }),
    });

    expect(result).toEqual({
      status: 'ok',
      oneLineSummary: 'Did a thing.',
      bullets: ['Opened file', 'Edited file'],
      tags: ['edit'],
      tokenCount: 321,
    });
  });

  it('returns error summary on bad JSON and never throws', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarizer-test-'));
    const transcriptPath = path.join(tmp, 'transcript.md');
    fs.writeFileSync(transcriptPath, 'did a thing');

    const result = await summarizeTranscript(transcriptPath, {
      timeoutMs: 1000,
      spawnImpl: async () => ({
        code: 0,
        stdout: 'not-json',
        stderr: '',
      }),
    });

    expect(result).toEqual({
      status: 'error',
      reason: 'invalid_summary_json',
    });
  });
});
