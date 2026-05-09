import type { RunReport } from '@harnesstune/shared';
import type { AgentIdentity } from '../types.js';

/** Per-platform config stored in collector.json platforms[].config */
export type PlatformConfig = Record<string, unknown>;

/**
 * PlatformPlugin — interface every platform adapter must implement.
 *
 * Plugins are pure data sources: no internal event loops, no file watchers,
 * no persistent state. The daemon owns the schedule and calls plugins on its
 * poll interval.
 */
export interface PlatformPlugin {
  /** Unique stable identifier: 'paperclip' | 'claude-desktop' | 'claude-code' | 'openclaw' */
  readonly id: string;
  /** Human-readable display name */
  readonly displayName: string;

  /**
   * Detect whether the platform is installed on this machine.
   * Used by `setup` to offer relevant platforms during onboarding.
   */
  detect(): Promise<boolean>;

  /**
   * Interactive first-time platform config via readline prompts.
   * Returns config values to be stored in collector.json platforms[].config.
   */
  setup(existing?: PlatformConfig): Promise<PlatformConfig>;

  /**
   * Discover all agents registered on this platform.
   * Called on each poll cycle; daemon merges results into the relay agent list.
   */
  discover(): Promise<AgentIdentity[]>;

  /**
   * Collect completed runs since the given timestamp.
   * Daemon tracks the `since` cursor per-plugin and advances it on success.
   */
  collectRuns(since: Date): Promise<RunReport[]>;
}
