import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentConfig {
  relayUrl: string;
  channelId: string;
  token: string;
  agentName?: string;
  pollInterval?: number;    // ms, default 60000
  reportInterval?: string;  // e.g. "24h", default "24h"
}

export const CONFIG_DIR = join(process.cwd(), '.harnesstune');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const PID_FILE = join(CONFIG_DIR, 'agent.pid');
const QUEUE_DIR = join(CONFIG_DIR, 'queue');

export function readConfig(): AgentConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('No config found. Run: harnesstune-agent register');
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as AgentConfig;
}

export function writeConfig(config: AgentConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function writePid(pid: number): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf-8').trim();
  return raw ? parseInt(raw, 10) : null;
}

export function removePid(): void {
  if (existsSync(PID_FILE)) {
    rmSync(PID_FILE);
  }
}

export function getQueueDir(): string {
  mkdirSync(QUEUE_DIR, { recursive: true });
  return QUEUE_DIR;
}
