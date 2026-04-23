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
    return existsSync(settingsFile) || markers.some(p => existsSync(p));
  }

  async setup(_existing?: PlatformConfig): Promise<PlatformConfig> {
    const binDir = join(COLLECTOR_DIR, 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(DEFAULT_CRON_RUNS_DIR, { recursive: true });

    const script = generateWrapperScript();
    writeFileSync(DEFAULT_WRAPPER_PATH, script, 'utf-8');
    chmodSync(DEFAULT_WRAPPER_PATH, 0o755);

    console.log(`\nWrapper script installed: ${DEFAULT_WRAPPER_PATH}`);
    console.log('\nTo use with cron, update your crontab entries:');
    console.log(`  crontab -e`);
    console.log(`\nReplace direct claude calls with the wrapper:`);
    console.log(`  Before: 0 9 * * * claude -p 'Generate the daily report'`);
    console.log(`  After:  0 9 * * * ${DEFAULT_WRAPPER_PATH} --name 'daily-report' claude -p 'Generate the daily report'`);
    console.log(`\nOr add ${binDir} to your PATH and use:`);
    console.log(`  0 9 * * * harnesstune-wrap --name 'daily-report' claude -p 'Generate the daily report'`);

    return {
      wrapperPath: DEFAULT_WRAPPER_PATH,
      cronRunsDir: DEFAULT_CRON_RUNS_DIR,
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

    let entries: string[];
    try {
      entries = readdirSync(this.cronRunsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      const filePath = join(this.cronRunsDir, entry);

      if (entry.endsWith('.json.tmp')) continue;
      if (!entry.endsWith('.json')) continue;

      try {
        const mtime = statSync(filePath).mtime.getTime();
        if (mtime < nowMs - STALE_FILE_AGE_MS) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
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
          console.warn(`Invalid run file (missing fields), skipping: ${entry}`);
          try { unlinkSync(filePath); } catch { /* ignore */ }
          continue;
        }

        const report = mapCronRunFile(runFile);

        if (new Date(report.finishedAt).getTime() < sinceMs) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
          continue;
        }

        runs.push(report);
        try { unlinkSync(filePath); } catch { /* ignore */ }
      } catch (err) {
        console.error(`Failed to process run file ${entry}:`, (err as Error).message);
      }
    }

    return runs;
  }
}
