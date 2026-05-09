import type { OpenClawEvent, OpenClawSession } from './types.js';

/** Gap threshold between events that triggers a new session boundary */
export const DEFAULT_SESSION_GAP_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Segments a flat array of OpenClawEvents into contiguous OpenClawSessions
 * by applying a time-gap heuristic. A new session begins when consecutive
 * events are separated by more than gapMs milliseconds.
 *
 * Events are sorted by ts before segmenting — caller does not need to
 * provide pre-sorted input.
 *
 * Returns [] for empty input.
 */
export function segmentEvents(
  events: OpenClawEvent[],
  gapMs: number = DEFAULT_SESSION_GAP_MS,
): OpenClawSession[] {
  if (events.length === 0) return [];

  // Sort events by timestamp ascending
  const sorted = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  const agentId = sorted[0].agentId;
  const sessions: OpenClawSession[] = [];
  let currentEvents: OpenClawEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTs = new Date(sorted[i - 1].ts).getTime();
    const currTs = new Date(sorted[i].ts).getTime();

    if (currTs - prevTs > gapMs) {
      // Flush current session
      sessions.push({
        agentId,
        startedAt: currentEvents[0].ts,
        finishedAt: currentEvents[currentEvents.length - 1].ts,
        events: currentEvents,
      });
      currentEvents = [sorted[i]];
    } else {
      currentEvents.push(sorted[i]);
    }
  }

  // Flush remaining buffer as the final session
  sessions.push({
    agentId,
    startedAt: currentEvents[0].ts,
    finishedAt: currentEvents[currentEvents.length - 1].ts,
    events: currentEvents,
  });

  return sessions;
}
