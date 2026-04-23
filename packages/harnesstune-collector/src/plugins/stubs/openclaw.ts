import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';

/**
 * OpenClaw stub plugin.
 * detect(): checks for OpenClaw installation markers.
 * discover(): stub — returns [].
 * collectRuns(): stub — returns [].
 * Real implementation: Phase 15.
 */
export class OpenClawPlugin implements PlatformPlugin {
  readonly id = 'openclaw';
  readonly displayName = 'OpenClaw';

  async detect(): Promise<boolean> {
    const markers = [
      join(homedir(), '.openclaw'),
      '/usr/local/bin/openclaw',
      '/opt/homebrew/bin/openclaw',
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(_existing?: PlatformConfig): Promise<PlatformConfig> {
    // No config needed for OpenClaw stub: uses default JSONL log location
    console.log('OpenClaw: using default JSONL log location. No additional configuration required.');
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
