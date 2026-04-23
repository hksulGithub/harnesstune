import type { PlatformPlugin } from './interface.js';
import { PaperclipPlugin } from './stubs/paperclip.js';
import { ClaudeDesktopPlugin } from './stubs/claude-desktop.js';
import { ClaudeCodePlugin } from './stubs/claude-code.js';
import { OpenClawPlugin } from './stubs/openclaw.js';

/**
 * Static plugin registry — all 4 plugins compiled in.
 * No dynamic require(), no runtime discovery.
 * Enabled/disabled state is controlled by collector.json platforms[].enabled.
 */
const ALL_PLUGINS: PlatformPlugin[] = [
  new PaperclipPlugin(),
  new ClaudeDesktopPlugin(),
  new ClaudeCodePlugin(),
  new OpenClawPlugin(),
];

/** Return all registered plugins */
export function getAllPlugins(): PlatformPlugin[] {
  return ALL_PLUGINS;
}

/** Return a plugin by its id, or undefined if not found */
export function getPlugin(id: string): PlatformPlugin | undefined {
  return ALL_PLUGINS.find(p => p.id === id);
}

/** Return plugins whose ids appear in the given enabled-ids list */
export function getEnabledPlugins(enabledIds: string[]): PlatformPlugin[] {
  return ALL_PLUGINS.filter(p => enabledIds.includes(p.id));
}
