import { randomUUID } from 'node:crypto';
import type { CollectorConfig } from '../config.js';
import { resolveToken } from '../config.js';
import type { RetryQueue } from '../queue.js';
import type { PlatformPlugin } from '../plugins/interface.js';

export interface PluginCursors {
  [pluginId: string]: Date;
}

export interface CycleResult {
  lastPoll: string;
  plugins: Record<string, { enabled: boolean; agentCount: number }>;
}

/**
 * Run one collection cycle: for each enabled plugin, call collectRuns(since),
 * upload results to relay, advance cursors.
 */
export async function runCycle(
  plugins: PlatformPlugin[],
  config: CollectorConfig,
  queue: RetryQueue,
  cursors: PluginCursors,
): Promise<CycleResult> {
  const token = resolveToken(config);
  const pluginSummary: Record<string, { enabled: boolean; agentCount: number }> = {};
  const enabledIds = new Set(config.platforms.filter(p => p.enabled).map(p => p.id));

  for (const plugin of plugins) {
    const enabled = enabledIds.has(plugin.id);
    if (!enabled) {
      pluginSummary[plugin.id] = { enabled: false, agentCount: 0 };
      continue;
    }

    try {
      // Discover agents for count
      const agents = await plugin.discover();
      pluginSummary[plugin.id] = { enabled: true, agentCount: agents.length };

      // Register discovered agents with relay
      for (const agent of agents) {
        try {
          await fetch(`${config.relayUrl}/api/channels/${config.channelId}/agents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              agentId: agent.agentId,
              name: agent.name,
              platform: agent.platform,
              schedule: agent.schedule,
            }),
          });
        } catch (err) {
          console.error(`Failed to register agent ${agent.agentId}:`, err);
        }
      }

      // Collect runs since last cursor
      const since = cursors[plugin.id] ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const runs = await plugin.collectRuns(since);

      // Upload each run to relay
      for (const run of runs) {
        const envelope = {
          type: 'run_batch' as const,
          body: { runs: [run] },
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
            queue.enqueue(config.channelId, envelope);
          }
        } catch {
          queue.enqueue(config.channelId, envelope);
        }
      }

      // Advance cursor
      if (runs.length > 0) {
        const latest = runs.reduce((max, r) => {
          const t = new Date(r.finishedAt);
          return t > max ? t : max;
        }, since);
        cursors[plugin.id] = latest;
      }
    } catch (err) {
      console.error(`Plugin ${plugin.id} error:`, err);
      pluginSummary[plugin.id] = { enabled: true, agentCount: 0 };
    }
  }

  // Attempt queue replay on successful cycle (relay is reachable)
  const relayClient = {
    post: async (path: string, body: unknown) =>
      fetch(`${config.relayUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
  };
  const replayed = await queue.replay(relayClient, config.channelId);
  if (replayed > 0) console.log(`Replayed ${replayed} queued report(s)`);

  return {
    lastPoll: new Date().toISOString(),
    plugins: pluginSummary,
  };
}
