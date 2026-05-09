/**
 * @harnesstune/collector — Collector daemon for multi-platform agent fleet management
 *
 * A single persistent process per machine that collects agent run data from all
 * installed platforms (Paperclip, Claude Desktop, Claude Code, OpenClaw) and
 * reports through the HarnessTune relay.
 *
 * Implementation in Phase 12.
 */
import { SHARED_VERSION } from '@harnesstune/shared';

export const COLLECTOR_VERSION = '0.0.1';
export { SHARED_VERSION };
