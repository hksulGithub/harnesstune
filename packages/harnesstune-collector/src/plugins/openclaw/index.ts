import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import { listAgentDirs, scanJsonlFiles } from './reader.js';
import { segmentEvents } from './segmenter.js';
import { mapAgentDir, mapSessionToRunReport } from './mappers.js';

const DEFAULT_AGENTS_DIR = join(homedir(), '.openclaw', 'agents');

export class OpenClawPlugin implements PlatformPlugin {
  readonly id = 'openclaw';
  readonly displayName = 'OpenClaw';

  private agentsDir?: string;

  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['agentsDir']) {
      this.agentsDir = platformConfig['agentsDir'] as string;
    }
  }

  async detect(): Promise<boolean> {
    const markers = [
      join(homedir(), '.openclaw'),
      '/usr/local/bin/openclaw',
      '/opt/homebrew/bin/openclaw',
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(_existing?: PlatformConfig, injectedRl?: ReadlineInterface): Promise<PlatformConfig> {
    const rl = injectedRl ?? createInterface({ input, output });
    const ownsRl = !injectedRl;
    try {
      const detected = existsSync(DEFAULT_AGENTS_DIR);
      if (detected) {
        console.log(`Found OpenClaw agents at: ${DEFAULT_AGENTS_DIR}`);
        return { agentsDir: DEFAULT_AGENTS_DIR };
      }
      const answer = (
        await rl.question(`OpenClaw agents directory [${DEFAULT_AGENTS_DIR}]: `)
      ).trim();
      const agentsDir = answer || DEFAULT_AGENTS_DIR;
      if (!existsSync(agentsDir)) {
        console.warn(`Warning: directory not found: ${agentsDir}`);
      }
      return { agentsDir };
    } finally {
      if (ownsRl) rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    if (!this.agentsDir) return [];
    try {
      const dirs = listAgentDirs(this.agentsDir);
      return dirs.map(mapAgentDir);
    } catch (err) {
      console.error('OpenClaw discover failed:', (err as Error).message);
      return [];
    }
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!this.agentsDir) return [];
    try {
      const eventsMap = scanJsonlFiles(this.agentsDir, since);
      const runs: RunReport[] = [];

      for (const [agentId, events] of eventsMap) {
        const sessions = segmentEvents(events);
        for (const session of sessions) {
          try {
            runs.push(mapSessionToRunReport(session));
          } catch (err) {
            console.error(
              `Failed to map session for ${agentId}:`,
              (err as Error).message,
            );
          }
        }
      }

      return runs;
    } catch (err) {
      console.error('OpenClaw collectRuns failed:', (err as Error).message);
      return [];
    }
  }
}
