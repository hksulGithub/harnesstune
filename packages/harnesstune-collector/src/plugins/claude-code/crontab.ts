import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CrontabEntry } from './types.js';

const execFileAsync = promisify(execFile);

const NAME_REGEX = /--name\s+['"]?([^'"]+?)['"]?(?:\s|$)/;

export function parseCrontab(output: string): CrontabEntry[] {
  const entries: CrontabEntry[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || /^\s*\w+=/.test(trimmed)) continue;
    if (!trimmed.includes('harnesstune-wrap')) continue;

    const nameMatch = trimmed.match(NAME_REGEX);
    if (!nameMatch) {
      console.warn(`harnesstune-wrap entry missing --name flag, skipping: ${trimmed}`);
      continue;
    }

    const agentName = nameMatch[1];

    let schedule: string;
    if (trimmed.startsWith('@')) {
      schedule = trimmed.split(/\s+/)[0];
    } else {
      const fields = trimmed.split(/\s+/);
      schedule = fields.slice(0, 5).join(' ');
    }

    entries.push({ schedule, agentName, rawLine: trimmed });
  }

  return entries;
}

export async function readCrontab(): Promise<CrontabEntry[]> {
  try {
    const { stdout } = await execFileAsync('crontab', ['-l']);
    return parseCrontab(stdout);
  } catch {
    return [];
  }
}
