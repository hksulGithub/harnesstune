import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDefaultConfig, writeConfig, CONFIG_FILE } from '../config.js';
import { getAllPlugins } from '../plugins/loader.js';
import type { PlatformEntry } from '../config.js';

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1]) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return flags;
}

/**
 * `harnesstune-collector setup` — guided onboarding.
 *
 * Flow:
 * 1. Prompt for relay URL
 * 2. Register a new channel (POST /api/channels) → get channelId + token
 * 3. Auto-detect installed platforms
 * 4. Offer to configure each detected platform
 * 5. Write ~/.harnesstune/collector.json (chmod 600)
 */
export async function setup(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const rl = createInterface({ input, output });

  try {
    console.log('');
    console.log('harnesstune-collector setup');
    console.log('===========================');
    console.log('This will configure the collector daemon for this machine.');
    console.log('');

    // Step 1: relay URL
    let relayUrl = flags['relay-url'];
    if (!relayUrl) {
      relayUrl = await rl.question('Relay URL [https://harnesstune-relay.vercel.app]: ');
      relayUrl = relayUrl.trim() || 'https://harnesstune-relay.vercel.app';
    }

    // Step 2: register channel
    console.log('\nRegistering this machine with the relay...');
    const machineName = flags['name'] ?? (await rl.question('Machine name (e.g. "MacBook Pro - Work"): ')).trim();
    if (!machineName) {
      console.error('Machine name is required.');
      process.exit(1);
    }

    const res = await fetch(`${relayUrl.replace(/\/$/, '')}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: machineName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      console.error('Channel registration failed:', err.error ?? res.statusText);
      process.exit(1);
    }

    const data = await res.json() as { channelId: string; token: string; message: string };
    console.log(`\nRegistered channel: ${data.channelId}`);
    console.log(data.message);
    console.log('\nIMPORTANT: Copy and save your token now:');
    console.log(`  ${data.token}`);
    console.log('');

    // Step 3: auto-detect platforms
    console.log('Detecting installed platforms...');
    const allPlugins = getAllPlugins();
    const detectedPlatforms: string[] = [];

    for (const plugin of allPlugins) {
      const detected = await plugin.detect();
      if (detected) {
        console.log(`  [FOUND] ${plugin.displayName}`);
        detectedPlatforms.push(plugin.id);
      } else {
        console.log(`  [ -- ] ${plugin.displayName} (not detected)`);
      }
    }

    // Step 4: configure detected platforms
    const platformEntries: PlatformEntry[] = [];

    for (const plugin of allPlugins) {
      const isDetected = detectedPlatforms.includes(plugin.id);
      let enabled = false;
      let platformConfig: Record<string, unknown> = {};

      if (isDetected) {
        const answer = await rl.question(`\nEnable ${plugin.displayName}? [Y/n]: `);
        enabled = answer.trim().toLowerCase() !== 'n';

        if (enabled) {
          console.log(`\nConfiguring ${plugin.displayName}:`);
          platformConfig = await plugin.setup();
        }
      }

      platformEntries.push({ id: plugin.id, enabled, config: platformConfig });
    }

    // Step 5: write config
    const config = createDefaultConfig(relayUrl, data.channelId, data.token);
    config.platforms = platformEntries;
    writeConfig(config);

    console.log(`\nConfig written to: ${CONFIG_FILE}`);
    console.log('File permissions: 600 (owner read/write only)');
    console.log('\nSetup complete. Run: harnesstune-collector start');
    console.log('For auto-start on login: harnesstune-collector install');
  } finally {
    rl.close();
  }
}
