import { randomUUID } from 'node:crypto';
import type { CollectorConfig } from '../config.js';
import { resolveToken } from '../config.js';
import type { RetryQueue } from '../queue.js';

export interface HeartbeatPluginSummary {
  [pluginId: string]: { enabled: boolean; agentCount: number };
}

export async function sendHeartbeat(
  config: CollectorConfig,
  queue: RetryQueue,
  status: 'connected' | 'disconnected',
  plugins: HeartbeatPluginSummary,
): Promise<void> {
  const token = resolveToken(config);
  const envelope = {
    type: 'heartbeat' as const,
    body: {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      plugins,
    },
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };

  try {
    const res = await fetch(`${config.relayUrl}/api/channels/${config.channelId}/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      console.error(`Heartbeat upload failed: ${res.status}`);
      queue.enqueue(config.channelId, envelope);
    }
  } catch (err) {
    console.error('Heartbeat error:', err);
    queue.enqueue(config.channelId, envelope);
  }
}
