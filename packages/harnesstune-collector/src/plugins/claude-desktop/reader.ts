import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ScheduledTask, ScheduledTasksFile, SessionFile } from './types.js';
import { resolveClaudeDesktopTranscriptPath } from '../../summaries/desktop-transcript.js';

const SCHEDULED_TASKS_FILE = 'scheduled-tasks.json';

export function getScheduledTasksMtime(sessionsDir: string): Date {
  try { return statSync(join(sessionsDir, SCHEDULED_TASKS_FILE)).mtime; } catch { return new Date(0); }
}

export function readScheduledTasks(sessionsDir: string): ScheduledTask[] {
  try {
    const raw = readFileSync(join(sessionsDir, SCHEDULED_TASKS_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as ScheduledTasksFile;
    return parsed.scheduledTasks ?? [];
  } catch { return []; }
}

export function readSessionFile(filePath: string): SessionFile | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SessionFile;
    // Runtime guard: a corrupt or empty payload yields a typed-but-invalid object.
    if (!parsed?.sessionId || typeof parsed.lastActivityAt !== 'number') return null;
    parsed.sessionPath = filePath;
    parsed.transcriptPath = resolveClaudeDesktopTranscriptPath(filePath);
    return parsed;
  } catch { return null; }
}

export function scanSessions(sessionsDir: string, since: Date): SessionFile[] {
  const sinceMs = since.getTime();
  const nowMs = Date.now();
  // Sessions whose lastActivityAt is within this window may still be running.
  const STALENESS_GUARD_MS = 30_000;
  const results: SessionFile[] = [];

  let entries: string[];
  try { entries = readdirSync(sessionsDir); } catch { return []; }

  for (const entry of entries) {
    if (!entry.startsWith('local_') || !entry.endsWith('.json')) continue;
    const filePath = join(sessionsDir, entry);
    try {
      const mtime = statSync(filePath).mtime.getTime();
      // Strict <: skip files at or before `since` (matches collector contract).
      if (mtime < sinceMs) continue;
    } catch { continue; }
    const session = readSessionFile(filePath);
    if (!session) continue;
    // D-02: only scheduled sessions are collected.
    if (!session.scheduledTaskId) continue;
    // Skip sessions that look like they may still be running.
    if (session.lastActivityAt > nowMs - STALENESS_GUARD_MS) continue;
    // Time filter on session data, mirroring the mtime check above.
    if (session.lastActivityAt < sinceMs) continue;
    results.push(session);
  }

  return results;
}
