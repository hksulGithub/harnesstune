import { existsSync, readdirSync, readFileSync, unlinkSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import type { CronRunFile } from '../claude-code/types.js';
import { mapCrontabEntry, mapCronRunFile } from '../claude-code/mappers.js';
import { readCrontab } from '../claude-code/crontab.js';
import { generateWrapperScript } from '../claude-code/wrapper.js';
import { COLLECTOR_DIR } from '../../config.js';
import { parseSummaryMode, shouldSummarizeRun } from '../../summaries/policy.js';
import { summarizeTranscript } from '../../summaries/summarizer.js';

const DEFAULT_WRAPPER_PATH = join(COLLECTOR_DIR, 'bin', 'harnesstune-wrap');
const DEFAULT_CRON_RUNS_DIR = join(COLLECTOR_DIR, 'cron-runs');
const STALE_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class ClaudeCodePlugin implements PlatformPlugin {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  private wrapperPath: string;
  private cronRunsDir: string;

  constructor(private readonly platformConfig?: PlatformConfig) {
    this.wrapperPath = (platformConfig?.['wrapperPath'] as string) ?? DEFAULT_WRAPPER_PATH;
    this.cronRunsDir = (platformConfig?.['cronRunsDir'] as string) ?? DEFAULT_CRON_RUNS_DIR;
  }

  async detect(): Promise<boolean> {
    const markers = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.nvm', 'versions'),
      join(homedir(), '.local', 'bin', 'claude'),
    ];
    const settingsFile = join(homedir(), '.claude', 'settings.json');
    return existsSync(settingsFile) || markers.some((p) => existsSync(p));
  }

  async setup(_existing?: PlatformConfig): Promise<PlatformConfig> {
    const binDir = join(COLLECTOR_DIR, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(DEFAULT_CRON_RUNS_DIR, { recursive: true });

    const script = generateWrapperScript();
    writeFileSync(DEFAULT_WRAPPER_PATH, script, 'utf-8');
    chmodSync(DEFAULT_WRAPPER_PATH, 0o755);

    return {
      wrapperPath: DEFAULT_WRAPPER_PATH,
      cronRunsDir: DEFAULT_CRON_RUNS_DIR,
      summaries: 'on',
    };
  }

  async discover(): Promise<AgentIdentity[]> {
    const entries = await readCrontab();
    return entries.map(mapCrontabEntry);
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!existsSync(this.cronRunsDir)) return [];

    const sinceMs = since.getTime();
    const nowMs = Date.now();
    const runs: RunReport[] = [];
    const summaryMode = parseSummaryMode(this.platformConfig?.['summaries']);

    let entries: string[];
    try {
      entries = readdirSync(this.cronRunsDir);
    } catch {
      return [];
    }

    let seenRunNumber = 0;

    for (const entry of entries) {
      const filePath = join(this.cronRunsDir, entry);
      if (entry.endsWith('.json.tmp')) continue;
      if (!entry.endsWith('.json')) continue;

      try {
        const mtime = statSync(filePath).mtime.getTime();
        if (mtime < nowMs - STALE_FILE_AGE_MS) {
          try { unlinkSync(filePath); } catch {}
          continue;
        }
        if (mtime < sinceMs) continue;
      } catch {
        continue;
      }

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const runFile = JSON.parse(raw) as CronRunFile;
        if (!runFile.agentName || !runFile.startedAt || !runFile.finishedAt) {
          try { unlinkSync(filePath); } catch {}
          continue;
        }

        const report = mapCronRunFile(runFile);
        seenRunNumber += 1;

        if (
          runFile.transcriptPath &&
          shouldSummarizeRun(summaryMode, seenRunNumber)
        ) {
          report.summary = await summarizeTranscript(runFile.transcriptPath, { timeoutMs: 15_000 });
        }

        runs.push(report);
        try { unlinkSync(filePath); } catch {}
      } catch (err) {
        console.error(`Failed to process run file ${entry}:`, (err as Error).message);
      }
    }

    return runs;
  }
}
