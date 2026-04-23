import type { PlatformPlugin } from './interface.js';
import { PaperclipPlugin } from './stubs/paperclip.js';
import { ClaudeDesktopPlugin } from './stubs/claude-desktop.js';
import { ClaudeCodePlugin } from './stubs/claude-code.js';
import { OpenClawPlugin } from './stubs/openclaw.js';
import { readConfig } from '../config.js';

/**
 * Build the plugin registry with injected config.
 *
 * Reads collector.json to pass platform-specific config to plugins that
 * need credentials at construction time (e.g., PaperclipPlugin needs
 * serverUrl + apiKey to initialize its HTTP client).
 *
 * If config doesn't exist (pre-setup), all plugins get undefined config.
 */
function buildPlugins(): PlatformPlugin[] {
  let platformConfigs: Record<string, Record<string, unknown>> = {};
  try {
    const cfg = readConfig();
    for (const p of cfg.platforms) {
      platformConfigs[p.id] = p.config;
    }
  } catch {
    // Config not yet written (pre-setup); plugins get no config
  }

  return [
    new PaperclipPlugin(platformConfigs['paperclip']),
    new ClaudeDesktopPlugin(platformConfigs['claude-desktop']),
    new ClaudeCodePlugin(platformConfigs['claude-code']),
    new OpenClawPlugin(),
  ];
}

/** Static plugin registry — built once at module load with injected config */
export const ALL_PLUGINS: PlatformPlugin[] = buildPlugins();

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
