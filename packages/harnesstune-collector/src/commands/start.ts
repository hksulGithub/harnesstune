import { readConfig, writePid, removePid, readPid, writeStatus, resolveToken } from '../config.js';
import type { CollectorConfig, CollectorStatus } from '../config.js';
import { RetryQueue } from '../queue.js';
import { ALL_PLUGINS } from '../plugins/loader.js';
import { sendHeartbeat } from '../daemon/heartbeat.js';
import { runCycle } from '../daemon/scheduler.js';
import type { PluginCursors } from '../daemon/scheduler.js';

const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5 * 60 * 1000;
const JITTER_MAX_MS = 5000;

export async function start(_args: string[], opts: { dryRun: boolean }): Promise<void> {
  const config = readConfig();
  const token = resolveToken(config);

  if (opts.dryRun) {
    console.log('Dry run — validating config...');
    console.log(`  Relay URL: ${config.relayUrl}`);
    console.log(`  Channel ID: ${config.channelId}`);
    console.log(`  Token: ${token.slice(0, 8)}...`);
    console.log(`  Poll interval: ${config.pollInterval ?? 60000}ms`);
    console.log(`  Heartbeat interval: ${config.heartbeatInterval ?? 300000}ms`);
    console.log(`  Platforms: ${config.platforms.filter(p => p.enabled).map(p => p.id).join(', ') || '(none)'}`);

    // Check relay reachability
    try {
      const res = await fetch(`${config.relayUrl.replace(/\/api$/, '')}/api/health`);
      console.log(`  Relay health: ${res.ok ? 'OK' : res.status}`);
    } catch (err) {
      console.error(`  Relay unreachable: ${err}`);
    }
    return;
  }

  // PID duplicate detection
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
  writePid(process.pid);

  const queue = new RetryQueue();
  const cursors: PluginCursors = {};

  // Filter to enabled plugins
  const enabledIds = new Set(config.platforms.filter(p => p.enabled).map(p => p.id));
  const enabledPlugins = ALL_PLUGINS.filter(p => enabledIds.has(p.id));

  // Build initial plugin summary
  function buildPluginSummary(): Record<string, { enabled: boolean; agentCount: number }> {
    const summary: Record<string, { enabled: boolean; agentCount: number }> = {};
    for (const p of ALL_PLUGINS) {
      summary[p.id] = { enabled: enabledIds.has(p.id), agentCount: 0 };
    }
    return summary;
  }

  // Graceful shutdown
  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down — sending disconnected heartbeat...');
    await sendHeartbeat(config, queue, 'disconnected', buildPluginSummary());
    removePid();
    process.exit(0);
  }
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT',  () => { void shutdown(); });
  process.on('SIGHUP',  () => { void shutdown(); });

  // Send initial connected heartbeat
  console.log(`Collector started (PID ${process.pid})`);
  console.log(`  Relay: ${config.relayUrl}`);
  console.log(`  Channel: ${config.channelId}`);
  console.log(`  Enabled plugins: ${enabledPlugins.map(p => p.displayName).join(', ') || '(none)'}`);
  console.log(`  Poll interval: ${config.pollInterval ?? 60000}ms`);
  console.log(`  Heartbeat interval: ${config.heartbeatInterval ?? 300000}ms`);

  await sendHeartbeat(config, queue, 'connected', buildPluginSummary());

  // Heartbeat timer (every heartbeatInterval, default 5 min)
  let lastPluginSummary = buildPluginSummary();
  const heartbeatTimer = setInterval(() => {
    if (!shuttingDown) void sendHeartbeat(config, queue, 'connected', lastPluginSummary);
  }, config.heartbeatInterval ?? 300000);
  heartbeatTimer.unref();

  // Poll loop with exponential backoff + jitter
  let currentBackoff = BACKOFF_INITIAL;

  const startedAt = new Date().toISOString();

  // Write initial status
  writeStatus({
    pid: process.pid,
    startedAt,
    lastHeartbeat: startedAt,
    lastPoll: null as unknown as string,
    plugins: buildPluginSummary(),
  });

  async function pollLoop(): Promise<void> {
    if (shuttingDown) return;
    try {
      const result = await runCycle(enabledPlugins, config, queue, cursors);
      lastPluginSummary = result.plugins;

      // Write status file
      const statusData: CollectorStatus = {
        pid: process.pid,
        startedAt: startedAt,
        lastHeartbeat: new Date().toISOString(),
        lastPoll: result.lastPoll,
        plugins: result.plugins,
      };
      writeStatus(statusData);

      currentBackoff = BACKOFF_INITIAL;
    } catch (err) {
      console.error('Poll error:', err);
      currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX);
    }

    if (!shuttingDown) {
      const baseDelay = currentBackoff === BACKOFF_INITIAL ? (config.pollInterval ?? 60000) : currentBackoff;
      const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
      setTimeout(() => { void pollLoop(); }, baseDelay + jitter);
    }
  }

  // Start first poll cycle
  void pollLoop();

  // Keep process alive
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {
      if (shuttingDown) { clearInterval(keepAlive); resolve(); }
    }, 1000);
    keepAlive.unref();
  });
}
