import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';

/**
 * Paperclip stub plugin.
 * detect(): checks for common Paperclip installation markers.
 * discover(): stub — returns [].
 * collectRuns(): stub — returns [].
 * Real implementation: Phase 13.
 */
export class PaperclipPlugin implements PlatformPlugin {
  readonly id = 'paperclip';
  readonly displayName = 'Paperclip';

  async detect(): Promise<boolean> {
    // Check for common Paperclip installation markers
    const markers = [
      join(homedir(), '.paperclip'),
      join(homedir(), 'Library', 'Application Support', 'Paperclip'),
      '/usr/local/bin/paperclip',
      '/opt/homebrew/bin/paperclip',
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
    const rl = createInterface({ input, output });
    try {
      const defaultUrl = (existing?.['serverUrl'] as string | undefined) ?? '';
      const serverUrl = await rl.question(
        `Paperclip server URL${defaultUrl ? ` [${defaultUrl}]` : ''}: `,
      );
      const apiKey = await rl.question('Paperclip API key: ');
      return {
        serverUrl: serverUrl.trim() || defaultUrl,
        apiKey: apiKey.trim(),
      };
    } finally {
      rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    // Stub: real implementation in Phase 13
    return [];
  }

  async collectRuns(_since: Date): Promise<RunReport[]> {
    // Stub: real implementation in Phase 13
    return [];
  }
}
