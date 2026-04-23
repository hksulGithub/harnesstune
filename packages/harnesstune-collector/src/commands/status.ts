import { readPid, readStatus, readConfig, CONFIG_FILE } from '../config.js';

export async function status(_args: string[]): Promise<void> {
  // Check if config exists
  let config;
  try {
    config = readConfig();
  } catch {
    console.log('Status: NOT CONFIGURED');
    console.log('Run: harnesstune-collector setup');
    return;
  }

  // Check PID file
  const pid = readPid();
  let running = false;

  if (pid !== null) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      // Stale PID — process not found
      running = false;
    }
  }

  // Read status file
  const statusData = readStatus();

  console.log('');
  console.log('harnesstune-collector status');
  console.log('============================');
  console.log(`Running:      ${running ? `YES (PID ${pid})` : 'NO'}`);
  console.log(`Config:       ${CONFIG_FILE}`);
  console.log(`Relay URL:    ${config.relayUrl}`);
  console.log(`Channel ID:   ${config.channelId}`);

  if (statusData) {
    console.log(`Started at:   ${statusData.startedAt}`);
    console.log(`Last heartbeat: ${statusData.lastHeartbeat}`);
    console.log(`Last poll:    ${statusData.lastPoll}`);

    const uptimeMs = Date.now() - new Date(statusData.startedAt).getTime();
    const uptimeMins = Math.floor(uptimeMs / 60_000);
    const uptimeH = Math.floor(uptimeMins / 60);
    const uptimeM = uptimeMins % 60;
    console.log(`Uptime:       ${uptimeH}h ${uptimeM}m`);

    console.log('\nPlugins:');
    for (const [id, info] of Object.entries(statusData.plugins)) {
      const enabled = info.enabled ? 'enabled' : 'disabled';
      console.log(`  ${id}: ${enabled}, ${info.agentCount} agent(s)`);
    }
  } else if (running) {
    console.log('(Status file not yet written — daemon may be starting up)');
  }

  console.log('');
}
