import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readConfig, writePid, removePid, readPid } from '../config.js';
import { createClient } from '../client.js';
import { RetryQueue } from '../queue.js';
import type { RelayClient } from '../client.js';

const execFileAsync = promisify(execFile);

// Timer constants
const HEARTBEAT_MS = 5 * 60 * 1000;
const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5 * 60 * 1000;
const JITTER_MAX_MS = 60_000;

/** Parse simple interval strings: "24h", "60m", "30s" → milliseconds */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(h|m|s)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  const n = parseInt(match[1], 10);
  if (match[2] === 'h') return n * 60 * 60 * 1000;
  if (match[2] === 'm') return n * 60 * 1000;
  return n * 1000;
}

/** Route an inbound to_agent message to the local agent via claude CLI */
async function routeMessage(body: Record<string, unknown>): Promise<void> {
  const text = typeof body['text'] === 'string' ? body['text'] : JSON.stringify(body);
  try {
    await execFileAsync('claude', ['-p', text]);
  } catch (err) {
    console.error('Message routing failed:', err);
  }
}

export async function start(_args: string[], opts?: { dryRun?: boolean }): Promise<void> {
  const config = readConfig();
  const client = createClient(config.relayUrl, config.token);
  const queue = new RetryQueue();

  // --- Dry run mode ---
  if (opts?.dryRun) {
    console.log('Dry run: config loaded successfully');
    console.log(`  relay URL:  ${config.relayUrl}`);
    console.log(`  channel ID: ${config.channelId}`);
    console.log(`  agent name: ${config.agentName ?? '(unnamed)'}`);
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
    console.log('Dry run complete — loop not started');
    process.exit(0);
  }

  // --- PID duplicate detection ---
  const existingPid = readPid();
  if (existingPid !== null) {
    try {
      process.kill(existingPid, 0); // signal 0 = existence check, throws if not found
      console.error(`Error: agent already running (PID ${existingPid}). Use 'harnesstune-agent stop' first.`);
      process.exit(1);
    } catch {
      // Process not found — stale PID file, continue
      console.warn(`Warning: stale PID file found for PID ${existingPid}, ignoring`);
      removePid();
    }
  }

  // Write PID file
  writePid(process.pid);

  const startTime = Date.now();
  let shuttingDown = false;
  let lastMessageCursor: string = new Date().toISOString();
  let lastReportTime = Date.now();
  let currentBackoff = BACKOFF_INITIAL;
  const pollInterval = config.pollInterval ?? 60_000;
  const reportIntervalMs = parseInterval(config.reportInterval ?? '24h');

  // --- Heartbeat helper ---
  async function sendHeartbeat(status: 'connected' | 'disconnected'): Promise<void> {
    const envelope = {
      type: 'heartbeat' as const,
      body: {
        status,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      generatedAt: new Date().toISOString(),
      reportId: randomUUID(),
    };
    try {
      const res = await client.post(`/api/channels/${config.channelId}/reports`, envelope);
      if (!res.ok) {
        console.error(`Heartbeat upload failed: ${res.status}`);
        queue.enqueue(config.channelId, envelope);
      }
    } catch (err) {
      console.error('Heartbeat error:', err);
      queue.enqueue(config.channelId, envelope);
    }
  }

  // --- Graceful shutdown ---
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down — sending disconnected heartbeat...');
    await sendHeartbeat('disconnected');
    removePid();
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGHUP', () => { void shutdown(); });

  // --- Initial connected heartbeat ---
  await sendHeartbeat('connected');
  console.log(`Agent started (PID ${process.pid}), channel ${config.channelId}`);

  // --- Heartbeat timer (every 5 minutes, unref'd) ---
  const heartbeatTimer = setInterval(() => {
    if (!shuttingDown) {
      void sendHeartbeat('connected');
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();

  // --- Report schedule check (every 60s, unref'd) ---
  const reportCheckTimer = setInterval(() => {
    if (shuttingDown) return;
    const elapsed = Date.now() - lastReportTime;
    if (elapsed >= reportIntervalMs) {
      lastReportTime = Date.now();
      const elapsedH = Math.round(elapsed / 1000 / 60 / 60);
      console.log(`Report due: ${elapsedH}h since last report. Trigger briefing upload.`);
    }
  }, 60_000);
  reportCheckTimer.unref();

  // --- Message poll loop with jitter and exponential backoff ---
  async function pollLoop(): Promise<void> {
    if (shuttingDown) return;
    try {
      const params: Record<string, string> = { limit: '50' };
      if (lastMessageCursor) params.since = lastMessageCursor;

      const res = await client.get(`/api/channels/${config.channelId}/messages`, params);
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);

      const data = await res.json() as {
        messages: Array<{ id: string; direction: string; body: Record<string, unknown>; createdAt: string }>;
        count: number;
      };

      for (const msg of data.messages) {
        if (msg.direction === 'to_agent') {
          await routeMessage(msg.body);
          await client.delete(`/api/channels/${config.channelId}/messages/${msg.id}`);
        }
        lastMessageCursor = msg.createdAt;
      }

      // Attempt queue replay on successful poll (relay is reachable)
      const replayed = await queue.replay(client);
      if (replayed > 0) {
        console.log(`Replayed ${replayed} queued report(s)`);
      }

      // Reset backoff on success
      currentBackoff = BACKOFF_INITIAL;
    } catch (err) {
      console.error('Poll error:', err);
      currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX);
    }

    if (!shuttingDown) {
      // Add jitter: base delay + random 0-60s
      const baseDelay = currentBackoff === BACKOFF_INITIAL ? pollInterval : currentBackoff;
      const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
      setTimeout(() => { void pollLoop(); }, baseDelay + jitter);
    }
  }

  // Random first-poll delay to stagger agent startups (prevents thundering herd)
  const firstPollDelay = Math.floor(Math.random() * pollInterval);
  console.log(`First poll in ${Math.round(firstPollDelay / 1000)}s (jittered startup)`);
  setTimeout(() => { void pollLoop(); }, firstPollDelay);

  // Keep process alive — the unref'd timers alone won't hold it open
  // A never-resolving promise keeps the event loop running
  await new Promise<void>((resolve) => {
    // Resolve only on shutdown (handled above via process.exit)
    // This prevents the async function from returning early
    const keepAlive = setInterval(() => {
      if (shuttingDown) {
        clearInterval(keepAlive);
        resolve();
      }
    }, 1000);
    keepAlive.unref();
  });

  // Fallback uptime logging (startup context)
  void startTime;
}
