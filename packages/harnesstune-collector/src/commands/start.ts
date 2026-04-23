import { readConfig, writePid, removePid, readPid, writeStatus, resolveToken } from '../config.js';
import { createClient } from '../client.js';
import { RetryQueue } from '../queue.js';
import { sendHeartbeat } from '../daemon/heartbeat.js';
import { PluginScheduler } from '../daemon/scheduler.js';
import { getEnabledPlugins } from '../plugins/loader.js';

const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5 * 60 * 1000;

export async function start(_args: string[], opts?: { dryRun?: boolean }): Promise<void> {
  const config = readConfig();
  const token = resolveToken(config);
  const client = createClient(config.relayUrl, token);
  const queue = new RetryQueue();

  // --- Dry run mode ---
  if (opts?.dryRun) {
    console.log('Dry run: config loaded successfully');
    console.log(`  relay URL:  ${config.relayUrl}`);
    console.log(`  channel ID: ${config.channelId}`);
    const enabled = config.platforms.filter(p => p.enabled).map(p => p.id);
    console.log(`  enabled platforms: ${enabled.length ? enabled.join(', ') : '(none)'}`);
    try {
      const res = await client.get('/health');
      if (res.ok) {
        console.log('Dry run: relay reachable (GET /health OK)');
      } else {
        console.error(`Dry run: relay returned ${res.status} on GET /health`);
        process.exit(1);
      }
    } catch (err) {
      console.error('Dry run: relay unreachable:', err);
      process.exit(1);
    }
    console.log('Dry run complete — daemon not started');
    process.exit(0);
  }

  // --- PID duplicate detection ---
  const existingPid = readPid();
  if (existingPid !== null) {
    try {
      process.kill(existingPid, 0);
      console.error(`Error: collector already running (PID ${existingPid}). Use 'harnesstune-collector stop' first.`);
      process.exit(1);
    } catch {
      console.warn(`Warning: stale PID file found for PID ${existingPid}, ignoring`);
      removePid();
    }
  }

  // Write PID file
  writePid(process.pid);

  const startedAt = new Date().toISOString();
  let shuttingDown = false;
  const heartbeatIntervalMs = config.heartbeatInterval ?? 300_000;
  const pollIntervalMs = config.pollInterval ?? 60_000;

  // Build enabled plugin list
  const enabledIds = config.platforms.filter(p => p.enabled).map(p => p.id);
  const enabledPlugins = getEnabledPlugins(enabledIds);
  const scheduler = new PluginScheduler(enabledPlugins, client, config.channelId, queue);

  // Initial plugin status map (0 agents until first poll)
  let pluginStatus: Record<string, { enabled: boolean; agentCount: number }> = {};
  for (const id of enabledIds) {
    pluginStatus[id] = { enabled: true, agentCount: 0 };
  }

  // --- Status file writer ---
  function updateStatusFile(lastPoll: string): void {
    writeStatus({
      pid: process.pid,
      startedAt,
      lastHeartbeat: new Date().toISOString(),
      lastPoll,
      plugins: pluginStatus,
    });
  }

  // --- Graceful shutdown ---
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down — sending disconnected heartbeat...');
    await sendHeartbeat(client, config.channelId, queue, 'disconnected', pluginStatus);
    removePid();
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGHUP', () => { void shutdown(); });

  // --- Initial connected heartbeat ---
  await sendHeartbeat(client, config.channelId, queue, 'connected', pluginStatus);
  console.log(`Collector started (PID ${process.pid}), channel ${config.channelId}`);
  console.log(`Enabled platforms: ${enabledIds.length ? enabledIds.join(', ') : '(none)'}`);

  updateStatusFile(new Date().toISOString());

  // --- Heartbeat timer ---
  const heartbeatTimer = setInterval(() => {
    if (!shuttingDown) {
      void sendHeartbeat(client, config.channelId, queue, 'connected', pluginStatus);
      updateStatusFile(new Date().toISOString());
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  // --- Plugin poll loop ---
  let currentBackoff = BACKOFF_INITIAL;

  async function pollLoop(): Promise<void> {
    if (shuttingDown) return;
    const pollTime = new Date().toISOString();
    try {
      pluginStatus = await scheduler.poll();
      updateStatusFile(pollTime);

      // Queue replay on successful poll
      const replayed = await queue.replay(client, config.channelId);
      if (replayed > 0) {
        console.log(`Replayed ${replayed} queued report(s)`);
      }

      currentBackoff = BACKOFF_INITIAL;
    } catch (err) {
      console.error('Poll error:', err);
      currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX);
    }

    if (!shuttingDown) {
      const delay = currentBackoff === BACKOFF_INITIAL ? pollIntervalMs : currentBackoff;
      setTimeout(() => { void pollLoop(); }, delay);
    }
  }

  // Stagger first poll by up to pollInterval to prevent thundering herd
  const firstPollDelay = Math.floor(Math.random() * pollIntervalMs);
  console.log(`First poll in ${Math.round(firstPollDelay / 1000)}s`);
  setTimeout(() => { void pollLoop(); }, firstPollDelay);

  // Keep process alive
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {
      if (shuttingDown) {
        clearInterval(keepAlive);
        resolve();
      }
    }, 1000);
    keepAlive.unref();
  });
}
