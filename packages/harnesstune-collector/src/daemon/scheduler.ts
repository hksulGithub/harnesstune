import { randomUUID } from 'node:crypto';
import type { PlatformPlugin } from '../plugins/interface.js';
import type { CollectorRelayClient } from '../client.js';
import type { RetryQueue } from '../queue.js';

/**
 * PluginScheduler — polls each enabled plugin on a configurable interval.
 *
 * For each plugin:
 *   1. Calls plugin.discover() to sync agent list with relay
 *   2. Calls plugin.collectRuns(since) to upload new run reports
 *   3. Advances the per-plugin `since` cursor on success
 *
 * The scheduler runs a single poll cycle and the daemon wraps it in a setInterval.
 */
export class PluginScheduler {
  /** Per-plugin cursor: tracks 'since' date for incremental run collection */
  private cursors = new Map<string, Date>();

  constructor(
    private readonly plugins: PlatformPlugin[],
    private readonly client: CollectorRelayClient,
    private readonly channelId: string,
    private readonly queue: RetryQueue,
  ) {}

  /**
   * Run one poll cycle across all plugins.
   * Returns the plugin status map (id → agentCount) for status file updates.
   */
  async poll(): Promise<Record<string, { enabled: boolean; agentCount: number }>> {
    const statusMap: Record<string, { enabled: boolean; agentCount: number }> = {};

    for (const plugin of this.plugins) {
      let agentCount = 0;
      try {
        // 1. Discover agents
        const agents = await plugin.discover();
        agentCount = agents.length;

        if (agents.length > 0) {
          // Upload agent registrations to relay
          for (const agent of agents) {
            await this.upsertAgent(agent, plugin.id);
          }
        }

        // 2. Collect runs since cursor
        const since = this.cursors.get(plugin.id) ?? new Date(0);
        const runs = await plugin.collectRuns(since);

        if (runs.length > 0) {
          await this.uploadRuns(runs);
          // Advance cursor to latest run timestamp
          const latest = runs.reduce((max, r) =>
            r.finishedAt > max.finishedAt ? r : max,
          );
          this.cursors.set(plugin.id, new Date(latest.finishedAt));
        }

        statusMap[plugin.id] = { enabled: true, agentCount };
      } catch (err) {
        console.error(`Plugin ${plugin.id} poll error:`, err);
        statusMap[plugin.id] = { enabled: true, agentCount };
      }
    }

    return statusMap;
  }

  private async upsertAgent(
    agent: { agentId: string; name: string; platform: string; schedule: string | null; lastRunAt: string | null; status: string },
    _pluginId: string,
  ): Promise<void> {
    try {
      await this.client.post(
        `/api/channels/${this.channelId}/agents`,
        { agentId: agent.agentId, name: agent.name, platform: agent.platform, schedule: agent.schedule },
      );
    } catch (err) {
      console.error(`Failed to upsert agent ${agent.agentId}:`, err);
    }
  }

  private async uploadRuns(runs: unknown[]): Promise<void> {
    const envelope = {
      type: 'run_batch' as const,
      body: { runs },
      generatedAt: new Date().toISOString(),
      reportId: randomUUID(),
    };
    try {
      const res = await this.client.post(
        `/api/channels/${this.channelId}/reports`,
        envelope,
      );
      if (!res.ok) {
        console.error(`Run batch upload failed: ${res.status}`);
        this.queue.enqueue(this.channelId, envelope);
      }
    } catch (err) {
      console.error('Run batch upload error:', err);
      this.queue.enqueue(this.channelId, envelope);
    }
  }
}
