import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenClawEvent } from './types.js';

/**
 * Returns directory names (not full paths) under agentsRoot.
 * Returns [] on any error.
 */
export function listAgentDirs(agentsRoot: string): string[] {
  try {
    return readdirSync(agentsRoot).filter(entry => {
      try {
        return statSync(join(agentsRoot, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Scans all JSONL session files under agentsRoot since the given date.
 * Returns a Map keyed by agent directory name with parsed OpenClawEvent arrays.
 */
export function scanJsonlFiles(agentsRoot: string, since: Date): Map<string, OpenClawEvent[]> {
  const result = new Map<string, OpenClawEvent[]>();
  const sinceMs = since.getTime();
  const STALENESS_GUARD_MS = 30_000;

  try {
    const agentDirs = listAgentDirs(agentsRoot);

    for (const agentDir of agentDirs) {
      const sessionsPath = join(agentsRoot, agentDir, 'sessions');
      const agentEvents: OpenClawEvent[] = [];

      let sessionFiles: string[];
      try {
        sessionFiles = readdirSync(sessionsPath).filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const file of sessionFiles) {
        const filePath = join(sessionsPath, file);

        try {
          const mtime = statSync(filePath).mtime.getTime();
          if (mtime < sinceMs) continue;
          // Staleness guard: skip files still being written (mtime within 30s of now)
          if (mtime > Date.now() - STALENESS_GUARD_MS) continue;
        } catch {
          continue;
        }

        let raw: string;
        try {
          raw = readFileSync(filePath, 'utf-8');
        } catch {
          continue;
        }

        const lines = raw.split('\n').filter(line => line.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as OpenClawEvent;
            // Ensure agentId is set from directory name if missing in event
            if (!parsed.agentId) {
              parsed.agentId = agentDir;
            }
            // Filter by timestamp — only include events on or after since
            const eventMs = new Date(parsed.ts).getTime();
            if (eventMs >= sinceMs) {
              agentEvents.push(parsed);
            }
          } catch {
            console.warn(`[openclaw-reader] Failed to parse JSONL line in ${filePath}: ${line.slice(0, 120)}`);
          }
        }
      }

      if (agentEvents.length > 0) {
        result.set(agentDir, agentEvents);
      }
    }
  } catch (err) {
    console.error('[openclaw-reader] Catastrophic error scanning agents root:', (err as Error).message);
    return new Map();
  }

  return result;
}
