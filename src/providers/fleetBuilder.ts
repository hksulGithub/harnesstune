import type { FleetWorkspaceSummary } from '../types/fleet.js';

export function mergeWorkspaceSummaries(
  local: FleetWorkspaceSummary[],
  relay: FleetWorkspaceSummary[],
): FleetWorkspaceSummary[] {
  const relayById = new Map(relay.map(summary => [summary.id, summary]));
  const merged: FleetWorkspaceSummary[] = local.map(summary => {
    const relayShadow = relayById.get(summary.id);
    if (!relayShadow) {
      return summary;
    }
    relayById.delete(summary.id);
    return {
      ...summary,
      relayStatus: relayShadow.health,
      relayError: relayShadow.relayError,
    };
  });

  merged.push(...relayById.values());
  return merged;
}
