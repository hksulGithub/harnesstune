import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';

const DEFAULT_SESSIONS_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'local-agent-mode-sessions',
);

/**
 * Claude Desktop stub plugin.
 * detect(): checks for Claude Desktop installation.
 * discover(): stub — returns [].
 * collectRuns(): stub — returns [].
 * Real implementation: Phase 14.
 */
export class ClaudeDesktopPlugin implements PlatformPlugin {
  readonly id = 'claude-desktop';
  readonly displayName = 'Claude Desktop';

  async detect(): Promise<boolean> {
    const markers = [
      '/Applications/Claude.app',
      join(homedir(), 'Applications', 'Claude.app'),
      join(homedir(), 'Library', 'Application Support', 'Claude'),
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
    const rl = createInterface({ input, output });
    try {
      const defaultDir = (existing?.['sessionsDir'] as string | undefined) ?? DEFAULT_SESSIONS_DIR;
      const sessionsDir = await rl.question(`Claude sessions directory [${defaultDir}]: `);
      return {
        sessionsDir: sessionsDir.trim() || defaultDir,
      };
    } finally {
      rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    // Stub: real implementation in Phase 14
    return [];
  }

  async collectRuns(_since: Date): Promise<RunReport[]> {
    // Stub: real implementation in Phase 14
    return [];
  }
}
