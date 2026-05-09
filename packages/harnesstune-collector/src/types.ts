/**
 * Collector-local type aliases and re-exports.
 * AgentIdentity is defined in the extension src/types/workspace.ts but the
 * collector cannot import extension-side code. We redeclare a compatible subset
 * here so the plugin interface stays self-contained.
 */

/** Minimal AgentIdentity as used by collector plugins */
export interface AgentIdentity {
  /** Platform-specific identifier (unique within channel) */
  agentId: string;
  /** Human-readable name */
  name: string;
  /** Platform string: 'paperclip' | 'claude-desktop' | 'claude-code' | 'openclaw' */
  platform: string;
  /** Cron expression or human description, null if unknown */
  schedule: string | null;
  /** ISO 8601 timestamp of last known run, null if no history */
  lastRunAt: string | null;
  /** Current status string */
  status: string;
}
