import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';

/**
 * Claude Code stub plugin.
 * detect(): checks for claude CLI binary.
 * discover(): stub — returns [].
 * collectRuns(): stub — returns [].
 * Real implementation: Phase 15.
 */
export class ClaudeCodePlugin implements PlatformPlugin {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  async detect(): Promise<boolean> {
    const markers = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(homedir(), '.nvm', 'versions'),  // nvm-installed global
      join(homedir(), '.local', 'bin', 'claude'),
    ];
    // Check for claude binary or ~/.claude/settings.json
    const settingsFile = join(homedir(), '.claude', 'settings.json');
    return existsSync(settingsFile) || markers.some(p => existsSync(p));
  }

  async setup(_existing?: PlatformConfig): Promise<PlatformConfig> {
    // No config needed for Claude Code: it auto-detects hook events
    console.log('Claude Code: no additional configuration required.');
    return {};
  }

  async discover(): Promise<AgentIdentity[]> {
    // Stub: real implementation in Phase 15
    return [];
  }

  async collectRuns(_since: Date): Promise<RunReport[]> {
    // Stub: real implementation in Phase 15
    return [];
  }
}
