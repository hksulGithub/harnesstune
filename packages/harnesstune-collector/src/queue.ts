import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueDir } from './config.js';

const MAX_QUEUE_SIZE = 48;
const REPLAY_MIN_INTERVAL_MS = 5000;

export interface QueueEntry {
  path: string;
  body: unknown;
  channelId: string;
  timestamp: number;
}

export interface RelayClient {
  post(path: string, body: unknown): Promise<Response>;
}

/**
 * Disk-persisted retry queue for failed relay uploads.
 * FIFO eviction at 48-entry cap. Rate-limited replay (min 5s between uploads).
 * Adapted from harnesstune-agent/src/queue.ts — same pattern, machine-level dir.
 */
export class RetryQueue {
  private readonly dir: string;

  constructor() {
    this.dir = getQueueDir();
  }

  /** Enqueue a failed report upload for later retry */
  enqueue(channelId: string, body: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    const entries = this.list();

    // FIFO eviction if at cap
    if (entries.length >= MAX_QUEUE_SIZE) {
      const oldest = entries[0];
      if (oldest) rmSync(oldest.path);
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = join(this.dir, filename);
    writeFileSync(
      filepath,
      JSON.stringify({ channelId, body, timestamp: Date.now() }),
      'utf-8',
    );
  }

  /** List queued entries sorted oldest-first */
  list(): QueueEntry[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        const filepath = join(this.dir, f);
        const data = JSON.parse(readFileSync(filepath, 'utf-8')) as {
          channelId: string;
          body: unknown;
          timestamp: number;
        };
        return { path: filepath, ...data } as QueueEntry;
      });
  }

  /**
   * Replay queued entries to relay.
   * Rate-limited: min 5s between uploads.
   * Returns count of successfully replayed entries.
   */
  async replay(client: RelayClient, channelId: string): Promise<number> {
    const entries = this.list();
    if (entries.length === 0) return 0;

    let replayed = 0;
    for (const entry of entries) {
      try {
        const res = await client.post(`/api/channels/${channelId}/reports`, entry.body);
        if (res.ok) {
          rmSync(entry.path);
          replayed++;
          // Rate limit: wait 5s before next upload
          if (replayed < entries.length) {
            await new Promise(resolve => setTimeout(resolve, REPLAY_MIN_INTERVAL_MS));
          }
        } else {
          // Relay returned error — stop replay, try again next cycle
          break;
        }
      } catch {
        // Network error — stop replay
        break;
      }
    }
    return replayed;
  }

  /** Get current queue size */
  size(): number {
    return this.list().length;
  }
}
