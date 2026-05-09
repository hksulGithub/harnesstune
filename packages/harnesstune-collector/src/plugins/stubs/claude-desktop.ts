import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import { mapScheduledTask, mapSessionToRunReport } from '../claude-desktop/mappers.js';
import { readScheduledTasks, scanSessions, getScheduledTasksMtime } from '../claude-desktop/reader.js';
import { parseSummaryMode, shouldSummarizeRun } from '../../summaries/policy.js';
import { summarizeTranscript } from '../../summaries/summarizer.js';

const DEFAULT_SESSIONS_BASE = join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'local-agent-mode-sessions',
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClaudeDesktopPlugin implements PlatformPlugin {
  readonly id = 'claude-desktop';
  readonly displayName = 'Claude Desktop';

  private sessionsDir?: string;
  private lastKnownMtime: Date = new Date(0);
  private cachedAgents: AgentIdentity[] = [];

  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['sessionsDir']) {
      this.sessionsDir = platformConfig['sessionsDir'] as string;
    }
  }

  async detect(): Promise<boolean> {
    const markers = [
      '/Applications/Claude.app',
      join(homedir(), 'Applications', 'Claude.app'),
      join(homedir(), 'Library', 'Application Support', 'Claude'),
    ];
    return markers.some((p) => existsSync(p));
  }

  async setup(existing?: PlatformConfig, injectedRl?: ReadlineInterface): Promise<PlatformConfig> {
    const rl = injectedRl ?? createInterface({ input, output });
    const ownsRl = !injectedRl;
    try {
      const paths = this.discoverSessionPaths();
      if (paths.length === 0) {
        const defaultDir = (existing?.['sessionsDir'] as string | undefined) ?? DEFAULT_SESSIONS_BASE;
        const sessionsDir = (await rl.question(`Claude Desktop sessions directory [${defaultDir}]: `)).trim() || defaultDir;
        return { sessionsDir, summaries: 'on' };
      }
      if (paths.length === 1) {
        return { sessionsDir: paths[0], summaries: 'on' };
      }
      const choice = await rl.question(`Select directory [1-${paths.length}]: `);
      const idx = parseInt(choice.trim(), 10) - 1;
      if (idx < 0 || idx >= paths.length) {
        throw new Error('Invalid selection.');
      }
      return { sessionsDir: paths[idx], summaries: 'on' };
    } finally {
      if (ownsRl) rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    if (!this.sessionsDir) return [];

    const currentMtime = getScheduledTasksMtime(this.sessionsDir);
    if (currentMtime.getTime() <= this.lastKnownMtime.getTime() && this.cachedAgents.length > 0) {
      return this.cachedAgents;
    }

    const tasks = readScheduledTasks(this.sessionsDir);
    this.cachedAgents = tasks.map(mapScheduledTask);
    this.lastKnownMtime = currentMtime;
    return this.cachedAgents;
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!this.sessionsDir) return [];

    const tasks = readScheduledTasks(this.sessionsDir);
    const taskIds = new Set(tasks.map((t) => t.id));
    const sessions = scanSessions(this.sessionsDir, since);
    const summaryMode = parseSummaryMode(this.platformConfig?.['summaries']);

    const runs: RunReport[] = [];
    let seenRunNumber = 0;

    for (const session of sessions) {
      if (!session.scheduledTaskId || !taskIds.has(session.scheduledTaskId)) continue;

      try {
        const report = mapSessionToRunReport(session, session.scheduledTaskId);
        seenRunNumber += 1;

        if (session.transcriptPath && shouldSummarizeRun(summaryMode, seenRunNumber)) {
          report.summary = await summarizeTranscript(session.transcriptPath, { timeoutMs: 15_000 });
        }

        runs.push(report);
      } catch (err) {
        console.error(`Failed to map session ${session.sessionId}:`, (err as Error).message);
      }
    }

    return runs;
  }

  private discoverSessionPaths(): string[] {
    const paths: string[] = [];
    if (!existsSync(DEFAULT_SESSIONS_BASE)) return paths;

    try {
      const orgDirs = readdirSync(DEFAULT_SESSIONS_BASE);
      for (const orgDir of orgDirs) {
        if (!UUID_PATTERN.test(orgDir)) continue;
        const orgPath = join(DEFAULT_SESSIONS_BASE, orgDir);
        try {
          if (!statSync(orgPath).isDirectory()) continue;
        } catch {
          continue;
        }
        const userDirs = readdirSync(orgPath);
        for (const userDir of userDirs) {
          const userPath = join(orgPath, userDir);
          const scheduledFile = join(userPath, 'scheduled-tasks.json');
          if (existsSync(scheduledFile)) {
            paths.push(userPath);
          }
        }
      }
    } catch {}

    return paths;
  }
}
