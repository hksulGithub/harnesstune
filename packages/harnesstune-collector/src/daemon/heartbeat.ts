import { randomUUID } from 'node:crypto';
import type { CollectorRelayClient } from '../client.js';
import type { RetryQueue } from '../queue.js';

export type HeartbeatStatus = 'connected' | 'disconnected';

export interface HeartbeatBody {
  status: HeartbeatStatus;
  uptimeSeconds: number;
  platform: 'collector';
  plugins: Record<string, { enabled: boolean; agentCount: number }>;
}

/**
 * Send a machine-level collector heartbeat to the relay.
 * On failure the envelope is enqueued for retry.
 */
export async function sendHeartbeat(
  client: CollectorRelayClient,
  channelId: string,
  queue: RetryQueue,
  status: HeartbeatStatus,
  plugins: Record<string, { enabled: boolean; agentCount: number }>,
): Promise<void> {
  const body: HeartbeatBody = {
    status,
    uptimeSeconds: Math.floor(process.uptime()),
    platform: 'collector',
    plugins,
  };
  const envelope = {
    type: 'heartbeat' as const,
    body,
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };

  try {
    const res = await client.post(`/api/channels/${channelId}/reports`, envelope);
    if (!res.ok) {
      console.error(`Heartbeat upload failed: ${res.status}`);
      queue.enqueue(channelId, envelope);
    }
  } catch (err) {
    console.error('Heartbeat error:', err);
    queue.enqueue(channelId, envelope);
  }
}
