import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeConfig } from '../config.js';

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1]) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return flags;
}

export async function register(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  let relayUrl = flags['relay-url'];
  let agentName = flags['name'];

  if (!relayUrl || !agentName) {
    const rl = createInterface({ input, output });
    try {
      relayUrl ??= await rl.question('Relay URL: ');
      agentName ??= await rl.question('Agent name: ');
    } finally {
      rl.close();
    }
  }

  const res = await fetch(`${relayUrl.replace(/\/$/, '')}/api/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: agentName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    console.error('Registration failed:', err.error ?? res.statusText);
    process.exit(1);
  }

  const data = await res.json() as { channelId: string; token: string; message: string };
  writeConfig({ relayUrl, channelId: data.channelId, token: data.token, agentName });

  console.log(`Registered as channel ${data.channelId}`);
  console.log(data.message);
}
