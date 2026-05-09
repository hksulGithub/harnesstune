import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunReportSummary } from '@harnesstune/shared';

const execFileAsync = promisify(execFile);

export interface SummarizeOptions {
  timeoutMs: number;
  claudePath?: string;
  spawnImpl?: (input: { transcript: string; prompt: string; timeoutMs: number; claudePath: string }) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
}

function buildPrompt(transcript: string): string {
  return [
    'Summarize the following agent run as JSON.',
    'Return exactly one JSON object with keys:',
    'oneLineSummary, bullets, tags, tokenCount',
    'bullets must be an array of short strings.',
    'tags must be an array of lowercase strings.',
    'tokenCount must be an integer estimate.',
    '',
    transcript,
  ].join('\n');
}

function parseSummaryJson(raw: string): RunReportSummary {
  try {
    const parsed = JSON.parse(raw) as {
      oneLineSummary?: unknown;
      bullets?: unknown;
      tags?: unknown;
      tokenCount?: unknown;
    };

    if (
      typeof parsed.oneLineSummary !== 'string' ||
      !Array.isArray(parsed.bullets) ||
      !parsed.bullets.every((item) => typeof item === 'string') ||
      !Array.isArray(parsed.tags) ||
      !parsed.tags.every((item) => typeof item === 'string') ||
      typeof parsed.tokenCount !== 'number'
    ) {
      return { status: 'error', reason: 'invalid_summary_json' };
    }

    return {
      status: 'ok',
      oneLineSummary: parsed.oneLineSummary,
      bullets: parsed.bullets,
      tags: parsed.tags,
      tokenCount: parsed.tokenCount,
    };
  } catch {
    return { status: 'error', reason: 'invalid_summary_json' };
  }
}

async function defaultSpawn(input: {
  transcript: string;
  prompt: string;
  timeoutMs: number;
  claudePath: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      input.claudePath,
      ['--print', input.prompt],
      { timeout: input.timeoutMs, maxBuffer: 1024 * 1024 },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  }
}

export async function summarizeTranscript(
  transcriptPath: string,
  options: SummarizeOptions,
): Promise<RunReportSummary> {
  try {
    const transcript = await readFile(transcriptPath, 'utf-8');
    const prompt = buildPrompt(transcript);
    const spawnImpl = options.spawnImpl ?? defaultSpawn;
    const result = await spawnImpl({
      transcript,
      prompt,
      timeoutMs: options.timeoutMs,
      claudePath: options.claudePath ?? 'claude',
    });

    if (result.code !== 0) {
      return {
        status: 'error',
        reason: result.stderr.includes('rate limit') ? 'rate_limited' : `claude_exit_${result.code}`,
      };
    }

    return parseSummaryJson(result.stdout.trim());
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : 'summary_failed',
    };
  }
}
